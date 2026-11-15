import MensagemProcessadaRepository from "../../domain/repository/MensagemProcessadaRepository";
import CancelarOrcamentoUseCase from "../../domain/usecase/Orcamento/CancelarOrcamentoUseCase";
import GerarOrcamentoUseCase from "../../domain/usecase/Orcamento/GerarOrcamentoUseCase";
import EstornarPagamentoUseCase from "../../domain/usecase/Pagamento/EstornarPagamentoUseCase";
import RegistrarPagamentoUseCase from "../../domain/usecase/Pagamento/RegistrarPagamentoUseCase";
import logger from "../logger";
import MessageConsumer, { Manipulador } from "./MessageConsumer";
import {
  BodyCancelarOrcamento,
  BodyEstornarPagamento,
  BodyGerarOrcamento,
  BodyRegistrarPagamento,
  FILAS,
  Mensagem,
  TipoComando,
} from "./contracts";

export type CasosDeUsoBilling = {
  gerarOrcamento: GerarOrcamentoUseCase;
  cancelarOrcamento: CancelarOrcamentoUseCase;
  registrarPagamento: RegistrarPagamentoUseCase;
  estornarPagamento: EstornarPagamentoUseCase;
};

// Adaptador de entrada assincrono do participante da Saga.
//
// Mapeia cada comando da fila saga.billing.comandos para o caso de uso
// correspondente. Repare que os quatro comandos vem em pares:
//
//   GERAR_ORCAMENTO      <-> CANCELAR_ORCAMENTO   (compensacao)
//   REGISTRAR_PAGAMENTO  <-> ESTORNAR_PAGAMENTO   (compensacao)
//
// Essa simetria e o que torna o rollback possivel sem transacao distribuida.
export default class ComandoConsumer {
  constructor(
    private readonly casos: CasosDeUsoBilling,
    private readonly mensagensProcessadas: MensagemProcessadaRepository,
    private readonly consumer: MessageConsumer = new MessageConsumer(),
  ) {}

  async iniciar(): Promise<void> {
    await this.consumer.consumir(FILAS.BILLING_COMANDOS, this.manipuladores());
  }

  manipuladores(): Record<string, Manipulador> {
    return {
      [TipoComando.GERAR_ORCAMENTO]: this.comIdempotencia(async (mensagem) => {
        const body = mensagem.body as BodyGerarOrcamento;
        await this.casos.gerarOrcamento.execute({
          sagaId: mensagem.header.sagaId,
          ordemServicoId: mensagem.header.ordemServicoId,
          clienteId: body.clienteId,
          clienteEmail: body.clienteEmail,
          veiculoId: body.veiculoId,
          itens: body.itens,
        });
      }),

      [TipoComando.CANCELAR_ORCAMENTO]: this.comIdempotencia(
        async (mensagem) => {
          const body = mensagem.body as BodyCancelarOrcamento;
          await this.casos.cancelarOrcamento.execute({
            sagaId: mensagem.header.sagaId,
            ordemServicoId: mensagem.header.ordemServicoId,
            orcamentoId: body.orcamentoId,
            motivo: body.motivo,
          });
        },
      ),

      [TipoComando.REGISTRAR_PAGAMENTO]: this.comIdempotencia(
        async (mensagem) => {
          const body = mensagem.body as BodyRegistrarPagamento;
          await this.casos.registrarPagamento.execute({
            sagaId: mensagem.header.sagaId,
            ordemServicoId: mensagem.header.ordemServicoId,
            orcamentoId: body.orcamentoId,
            clienteId: body.clienteId,
            valor: Number(body.valor),
            simularFalha: body.simularFalha,
          });
        },
      ),

      [TipoComando.ESTORNAR_PAGAMENTO]: this.comIdempotencia(
        async (mensagem) => {
          const body = mensagem.body as BodyEstornarPagamento;
          await this.casos.estornarPagamento.execute({
            sagaId: mensagem.header.sagaId,
            ordemServicoId: mensagem.header.ordemServicoId,
            pagamentoId: body.pagamentoId,
            motivo: body.motivo,
          });
        },
      ),
    };
  }

  // Desduplicacao duravel aplicada a TODOS os comandos.
  //
  // O MessageConsumer ja descarta duplicatas em memoria, o que nao sobrevive a
  // um restart do pod nem cobre duas replicas. Aqui a verificacao e no banco:
  // cobrar ou estornar duas vezes e um erro com consequencia financeira.
  private comIdempotencia(manipulador: Manipulador): Manipulador {
    return async (mensagem: Mensagem) => {
      const { mensagemId, tipo, sagaId } = mensagem.header;

      if (await this.mensagensProcessadas.jaProcessada(mensagemId)) {
        logger.warn(
          { mensagemId, tipo },
          "comando duplicado ignorado (idempotencia duravel)",
        );
        return;
      }

      await manipulador(mensagem);

      // Registrado DEPOIS da execucao: se o processamento falhar, a mensagem
      // volta para a fila e precisa poder ser reprocessada.
      await this.mensagensProcessadas.registrar({
        mensagemId,
        tipo: String(tipo),
        sagaId,
      });
    };
  }
}
