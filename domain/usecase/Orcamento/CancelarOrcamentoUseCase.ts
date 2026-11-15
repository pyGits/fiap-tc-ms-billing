import MensageriaGateway from "../../gateway/MensageriaGateway";
import TelemetriaGateway from "../../gateway/TelemetriaGateway";
import OrcamentoRepository from "../../repository/OrcamentoRepository";
import { TipoResposta } from "../../../src/messaging/contracts";
import logger from "../../../src/logger";

export type InputCancelarOrcamento = {
  sagaId: string;
  ordemServicoId: string;
  orcamentoId?: string;
  motivo: string;
};

// TRANSACAO COMPENSATORIA de GERAR_ORCAMENTO.
//
// Tres propriedades que toda compensacao precisa ter (Aula 1 do SAGA Pattern):
//
//   1. Idempotente - pode ser reentregue pelo broker;
//   2. Sempre "bem-sucedida" do ponto de vista da Saga - se a compensacao
//      tambem pudesse falhar e abortar, a Saga ficaria presa em um estado
//      inconsistente sem saida. Nao encontrar o orcamento nao e erro: significa
//      que nao ha nada a desfazer;
//   3. Semanticamente reversa - cancelar e o oposto de gerar, mas o registro
//      nao desaparece: ele fica no historico marcado como CANCELADO. Uma Saga
//      e ACD, nao ACID, e nao existe "undo" - existe uma nova transacao que
//      anula o efeito da anterior.
export default class CancelarOrcamentoUseCase {
  constructor(
    private readonly orcamentoRepository: OrcamentoRepository,
    private readonly mensageria: MensageriaGateway,
    private readonly telemetria: TelemetriaGateway,
  ) {}

  async execute(input: InputCancelarOrcamento): Promise<void> {
    const inicio = Date.now();
    const ctx = {
      sagaId: input.sagaId,
      ordemServicoId: input.ordemServicoId,
    };

    const orcamento = input.orcamentoId
      ? await this.orcamentoRepository.obter(input.orcamentoId)
      : await this.orcamentoRepository.obterPorSaga(input.sagaId);

    if (!orcamento) {
      logger.warn(
        { sagaId: input.sagaId, orcamentoId: input.orcamentoId },
        "compensacao sem orcamento correspondente: nada a desfazer",
      );
    } else {
      orcamento.cancelar(input.motivo);
      await this.orcamentoRepository.atualizar(orcamento);
    }

    this.telemetria.registrarComando({
      ...ctx,
      comando: "CANCELAR_ORCAMENTO",
      resultado: "COMPENSADO",
      duracaoMs: Date.now() - inicio,
    });

    // A confirmacao da compensacao fecha o rastro do rollback no saga log do
    // orquestrador - e a evidencia auditavel de que o efeito foi desfeito.
    await this.mensageria.responder(ctx, TipoResposta.ORCAMENTO_CANCELADO, {
      orcamentoId: orcamento?.id.getValue(),
      motivo: input.motivo,
    });
  }
}
