import ErroDominio from "../../ErroDominio";
import Orcamento, { StatusOrcamento } from "../../entity/Orcamento";
import OrcamentoRepository from "../../repository/OrcamentoRepository";

export type OrcamentoApresentado = {
  id: string;
  ordemServicoId: string;
  clienteId: string;
  veiculoId: string;
  sagaId: string;
  status: string;
  valorTotal: number;
  itens: Array<{
    referenciaId: string;
    descricao: string;
    tipo: string;
    quantidade: number;
    valorUnitario: number;
    total: number;
  }>;
  motivoCancelamento?: string;
  criadoEm: string;
  atualizadoEm: string;
};

// Consultas do contexto de Billing expostas por REST (sincrono), usadas pelo
// cliente para ver o orcamento antes de aprovar.
export default class ConsultarOrcamentoUseCase {
  constructor(private readonly orcamentoRepository: OrcamentoRepository) {}

  async porId(id: string): Promise<OrcamentoApresentado> {
    const orcamento = await this.orcamentoRepository.obter(id);
    if (!orcamento) {
      throw ErroDominio.naoEncontrado(
        "orcamento.nao.encontrado",
        "Orcamento nao encontrado.",
      );
    }
    return this.apresentar(orcamento);
  }

  async porOrdemServico(ordemServicoId: string): Promise<OrcamentoApresentado> {
    const orcamento =
      await this.orcamentoRepository.obterPorOrdemServico(ordemServicoId);
    if (!orcamento) {
      throw ErroDominio.naoEncontrado(
        "orcamento.nao.encontrado",
        "Nao existe orcamento para esta ordem de servico.",
      );
    }
    return this.apresentar(orcamento);
  }

  async listar(status?: string): Promise<OrcamentoApresentado[]> {
    const filtro = status
      ? (status.toUpperCase() as StatusOrcamento)
      : undefined;
    const orcamentos = await this.orcamentoRepository.listar(filtro);
    return orcamentos.map((orcamento) => this.apresentar(orcamento));
  }

  private apresentar(orcamento: Orcamento): OrcamentoApresentado {
    return {
      id: orcamento.id.getValue(),
      ordemServicoId: orcamento.ordemServicoId,
      clienteId: orcamento.clienteId,
      veiculoId: orcamento.veiculoId,
      sagaId: orcamento.sagaId,
      status: orcamento.status,
      valorTotal: orcamento.valorTotal,
      itens: orcamento.itens.map((item) => ({
        referenciaId: item.referenciaId,
        descricao: item.descricao,
        tipo: item.tipo,
        quantidade: item.quantidade,
        valorUnitario: item.valorUnitario,
        total: item.getTotal(),
      })),
      motivoCancelamento: orcamento.motivoCancelamento,
      criadoEm: orcamento.criadoEm.toISOString(),
      atualizadoEm: orcamento.atualizadoEm.toISOString(),
    };
  }
}
