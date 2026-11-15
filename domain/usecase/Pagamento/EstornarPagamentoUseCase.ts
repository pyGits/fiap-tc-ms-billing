import MensageriaGateway from "../../gateway/MensageriaGateway";
import PagamentoExternoGateway from "../../gateway/PagamentoExternoGateway";
import TelemetriaGateway from "../../gateway/TelemetriaGateway";
import PagamentoRepository from "../../repository/PagamentoRepository";
import { TipoResposta } from "../../../src/messaging/contracts";
import logger from "../../../src/logger";

export type InputEstornarPagamento = {
  sagaId: string;
  ordemServicoId: string;
  pagamentoId?: string;
  motivo: string;
};

// TRANSACAO COMPENSATORIA de REGISTRAR_PAGAMENTO.
//
// E a compensacao mais delicada da Saga: ela devolve dinheiro. Por isso:
//
//   - idempotente no agregado (Pagamento.estornar() ignora reentrega);
//   - a falha na chamada ao provedor externo NAO propaga erro para a Saga. O
//     estado local vira ESTORNADO e a divergencia com o provedor e registrada
//     como falha de integracao para conciliacao posterior. Abortar aqui
//     deixaria a Saga presa em COMPENSANDO para sempre;
//   - responde sempre, para o orquestrador poder concluir o rollback.
export default class EstornarPagamentoUseCase {
  constructor(
    private readonly pagamentoRepository: PagamentoRepository,
    private readonly pagamentoExterno: PagamentoExternoGateway,
    private readonly mensageria: MensageriaGateway,
    private readonly telemetria: TelemetriaGateway,
  ) {}

  async execute(input: InputEstornarPagamento): Promise<void> {
    const inicio = Date.now();
    const ctx = {
      sagaId: input.sagaId,
      ordemServicoId: input.ordemServicoId,
    };

    const pagamento = input.pagamentoId
      ? await this.pagamentoRepository.obter(input.pagamentoId)
      : await this.pagamentoRepository.obterPorSaga(input.sagaId);

    if (!pagamento) {
      logger.warn(
        { sagaId: input.sagaId },
        "compensacao sem pagamento correspondente: nada a estornar",
      );
      await this.mensageria.responder(ctx, TipoResposta.PAGAMENTO_ESTORNADO, {
        motivo: input.motivo,
      });
      return;
    }

    if (pagamento.estaEstornado()) {
      await this.mensageria.responder(ctx, TipoResposta.PAGAMENTO_ESTORNADO, {
        pagamentoId: pagamento.id.getValue(),
        motivo: input.motivo,
      });
      return;
    }

    if (pagamento.estaAprovado() && pagamento.idExterno) {
      try {
        await this.pagamentoExterno.estornar(pagamento.idExterno, input.motivo);
      } catch (erro) {
        const falha = erro instanceof Error ? erro.message : String(erro);

        // Divergencia entre o estado local e o provedor: registramos para
        // conciliacao e seguimos com a compensacao.
        this.telemetria.registrarFalhaIntegracao({
          integracao: "mercado-pago",
          operacao: "estornar",
          erro: falha,
        });
        logger.error(
          { pagamentoId: pagamento.id.getValue(), erro: falha },
          "falha ao estornar no provedor externo; estorno registrado localmente para conciliacao",
        );
      }
    }

    pagamento.estornar(input.motivo);
    await this.pagamentoRepository.atualizar(pagamento);

    this.telemetria.registrarEstorno({
      ...ctx,
      pagamentoId: pagamento.id.getValue(),
      valor: pagamento.valor,
      motivo: input.motivo,
    });

    this.telemetria.registrarComando({
      ...ctx,
      comando: "ESTORNAR_PAGAMENTO",
      resultado: "COMPENSADO",
      duracaoMs: Date.now() - inicio,
    });

    await this.mensageria.responder(ctx, TipoResposta.PAGAMENTO_ESTORNADO, {
      pagamentoId: pagamento.id.getValue(),
      valor: pagamento.valor,
      motivo: input.motivo,
    });
  }
}
