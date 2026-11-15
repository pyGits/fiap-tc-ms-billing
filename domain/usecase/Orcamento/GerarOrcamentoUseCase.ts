import Orcamento from "../../entity/Orcamento";
import ItemOrcamento from "../../entity/ItemOrcamento";
import MensageriaGateway from "../../gateway/MensageriaGateway";
import TelemetriaGateway from "../../gateway/TelemetriaGateway";
import OrcamentoRepository from "../../repository/OrcamentoRepository";
import { TipoResposta } from "../../../src/messaging/contracts";

export type InputGerarOrcamento = {
  sagaId: string;
  ordemServicoId: string;
  clienteId: string;
  clienteEmail?: string;
  veiculoId: string;
  itens: Array<{
    id: string;
    descricao: string;
    quantidade: number;
    valorUnitario: number;
    tipo: string;
  }>;
};

// Passo 2 da Saga, do lado do participante.
//
// Anatomia de um passo de Saga:
//   1. executa a transacao LOCAL (grava o orcamento no MongoDB do Billing);
//   2. responde ao orquestrador na fila de reply.
//
// A transacao local e atomica; a consistencia com os outros servicos e
// eventual. Se o passo 1 falhar, respondemos ORCAMENTO_FALHOU e o orquestrador
// dispara a compensacao - nunca deixamos a Saga sem resposta.
export default class GerarOrcamentoUseCase {
  constructor(
    private readonly orcamentoRepository: OrcamentoRepository,
    private readonly mensageria: MensageriaGateway,
    private readonly telemetria: TelemetriaGateway,
  ) {}

  async execute(input: InputGerarOrcamento): Promise<Orcamento | null> {
    const inicio = Date.now();
    const ctx = {
      sagaId: input.sagaId,
      ordemServicoId: input.ordemServicoId,
    };

    try {
      // Idempotencia de negocio: se ja existe orcamento para esta Saga, apenas
      // repetimos a resposta. Gerar dois orcamentos para a mesma OS seria um
      // efeito colateral duplicado - exatamente o que a reentrega provoca.
      const existente = await this.orcamentoRepository.obterPorSaga(input.sagaId);
      if (existente && !existente.estaCancelado()) {
        await this.mensageria.responder(ctx, TipoResposta.ORCAMENTO_GERADO, {
          orcamentoId: existente.id.getValue(),
          valorTotal: existente.valorTotal,
        });
        return existente;
      }

      const itens = input.itens.map(
        (item) =>
          new ItemOrcamento({
            referenciaId: item.id,
            descricao: item.descricao,
            tipo: item.tipo,
            quantidade: item.quantidade,
            valorUnitario: item.valorUnitario,
          }),
      );

      const orcamento = new Orcamento({
        ordemServicoId: input.ordemServicoId,
        clienteId: input.clienteId,
        clienteEmail: input.clienteEmail,
        veiculoId: input.veiculoId,
        sagaId: input.sagaId,
        itens,
      });

      await this.orcamentoRepository.salvar(orcamento);

      await this.mensageria.responder(ctx, TipoResposta.ORCAMENTO_GERADO, {
        orcamentoId: orcamento.id.getValue(),
        valorTotal: orcamento.valorTotal,
      });

      this.telemetria.registrarComando({
        ...ctx,
        comando: "GERAR_ORCAMENTO",
        resultado: "CONCLUIDO",
        duracaoMs: Date.now() - inicio,
      });

      return orcamento;
    } catch (erro) {
      const motivo = erro instanceof Error ? erro.message : String(erro);

      this.telemetria.registrarComando({
        ...ctx,
        comando: "GERAR_ORCAMENTO",
        resultado: "FALHOU",
        duracaoMs: Date.now() - inicio,
        erro: motivo,
      });

      await this.mensageria.responder(ctx, TipoResposta.ORCAMENTO_FALHOU, {
        motivo,
      });

      return null;
    }
  }
}
