import ErroDominio from "../../ErroDominio";
import Pagamento, { MeioPagamento } from "../../entity/Pagamento";
import MensageriaGateway from "../../gateway/MensageriaGateway";
import PagamentoExternoGateway from "../../gateway/PagamentoExternoGateway";
import TelemetriaGateway from "../../gateway/TelemetriaGateway";
import OrcamentoRepository from "../../repository/OrcamentoRepository";
import PagamentoRepository from "../../repository/PagamentoRepository";
import { TipoResposta } from "../../../src/messaging/contracts";

export type InputRegistrarPagamento = {
  sagaId: string;
  ordemServicoId: string;
  orcamentoId: string;
  clienteId: string;
  valor: number;
  meio?: string;
  // Forca uma recusa controlada para demonstrar o rollback no video.
  simularFalha?: boolean;
};

// Passo 4 da Saga: cobranca do orcamento aprovado.
//
// Este e o passo com efeito colateral EXTERNO (dinheiro no Mercado Pago), por
// isso ele vem antes de enfileirar a execucao: estornar uma cobranca e muito
// mais simples do que desmontar uma oficina. A reordenacao e a contramedida
// "Pessimistic View" descrita na Aula 3 do SAGA Pattern.
export default class RegistrarPagamentoUseCase {
  constructor(
    private readonly pagamentoRepository: PagamentoRepository,
    private readonly orcamentoRepository: OrcamentoRepository,
    private readonly pagamentoExterno: PagamentoExternoGateway,
    private readonly mensageria: MensageriaGateway,
    private readonly telemetria: TelemetriaGateway,
  ) {}

  async execute(input: InputRegistrarPagamento): Promise<Pagamento | null> {
    const inicio = Date.now();
    const ctx = {
      sagaId: input.sagaId,
      ordemServicoId: input.ordemServicoId,
    };

    try {
      // Idempotencia: nunca cobrar duas vezes pela mesma Saga.
      const existente = await this.pagamentoRepository.obterPorSaga(input.sagaId);
      if (existente?.estaAprovado()) {
        await this.mensageria.responder(ctx, TipoResposta.PAGAMENTO_REGISTRADO, {
          pagamentoId: existente.id.getValue(),
          valor: existente.valor,
          status: existente.status,
          idExterno: existente.idExterno,
        });
        return existente;
      }

      const orcamento = await this.orcamentoRepository.obter(input.orcamentoId);
      if (!orcamento) {
        throw ErroDominio.naoEncontrado(
          "orcamento.nao.encontrado",
          "Orcamento informado nao existe neste servico.",
        );
      }
      if (orcamento.estaCancelado()) {
        throw new ErroDominio(
          "orcamento.cancelado",
          "Nao e possivel cobrar um orcamento cancelado.",
          409,
        );
      }

      // O orcamento e aprovado aqui porque a decisao do cliente chegou junto
      // com o comando de cobranca - o OS Service e a fonte da verdade sobre a
      // aprovacao; o Billing apenas reflete esse fato no proprio agregado.
      if (orcamento.status === "GERADO") {
        orcamento.aprovar();
        await this.orcamentoRepository.atualizar(orcamento);
      }

      const pagamento = new Pagamento({
        orcamentoId: orcamento.id.getValue(),
        ordemServicoId: input.ordemServicoId,
        clienteId: input.clienteId,
        sagaId: input.sagaId,
        valor: input.valor || orcamento.valorTotal,
        meio: (input.meio as MeioPagamento) ?? MeioPagamento.PIX,
      });

      await this.pagamentoRepository.salvar(pagamento);

      if (input.simularFalha) {
        throw new ErroDominio(
          "pagamento.falha.simulada",
          "Falha simulada no pagamento para demonstracao do rollback da Saga.",
          402,
        );
      }

      const cobranca = await this.pagamentoExterno.criarCobranca({
        pagamentoId: pagamento.id.getValue(),
        ordemServicoId: input.ordemServicoId,
        descricao: `Ordem de servico ${input.ordemServicoId}`,
        valor: pagamento.valor,
        emailCliente: orcamento.clienteEmail,
      });

      if (cobranca.status === "RECUSADO") {
        pagamento.recusar(cobranca.motivo ?? "Pagamento recusado pelo provedor.");
        await this.pagamentoRepository.atualizar(pagamento);
        throw new ErroDominio(
          "pagamento.recusado",
          pagamento.motivoRecusa ?? "Pagamento recusado.",
          402,
        );
      }

      pagamento.aprovar(cobranca.idExterno, cobranca.qrCode);
      await this.pagamentoRepository.atualizar(pagamento);

      this.telemetria.registrarPagamento({
        ...ctx,
        pagamentoId: pagamento.id.getValue(),
        valor: pagamento.valor,
        meio: pagamento.meio,
        status: pagamento.status,
      });

      this.telemetria.registrarComando({
        ...ctx,
        comando: "REGISTRAR_PAGAMENTO",
        resultado: "CONCLUIDO",
        duracaoMs: Date.now() - inicio,
      });

      await this.mensageria.responder(ctx, TipoResposta.PAGAMENTO_REGISTRADO, {
        pagamentoId: pagamento.id.getValue(),
        valor: pagamento.valor,
        status: pagamento.status,
        idExterno: pagamento.idExterno,
      });

      return pagamento;
    } catch (erro) {
      const motivo = erro instanceof Error ? erro.message : String(erro);

      this.telemetria.registrarComando({
        ...ctx,
        comando: "REGISTRAR_PAGAMENTO",
        resultado: "FALHOU",
        duracaoMs: Date.now() - inicio,
        erro: motivo,
      });

      // Responder a falha e OBRIGATORIO: e o gatilho do rollback. Um
      // participante que apenas registra o erro em log deixa a Saga pendurada.
      await this.mensageria.responder(ctx, TipoResposta.PAGAMENTO_FALHOU, {
        motivo,
        codigo: erro instanceof ErroDominio ? erro.codigo : "pagamento.erro",
      });

      return null;
    }
  }
}
