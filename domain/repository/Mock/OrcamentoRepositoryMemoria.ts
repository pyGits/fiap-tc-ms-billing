import Orcamento, { StatusOrcamento } from "../../entity/Orcamento";
import OrcamentoRepository from "../OrcamentoRepository";

export default class OrcamentoRepositoryMemoria implements OrcamentoRepository {
  private readonly registros = new Map<string, Orcamento>();

  async salvar(orcamento: Orcamento): Promise<void> {
    this.registros.set(orcamento.id.getValue(), orcamento);
  }

  async atualizar(orcamento: Orcamento): Promise<void> {
    this.registros.set(orcamento.id.getValue(), orcamento);
  }

  async obter(id: string): Promise<Orcamento | null> {
    return this.registros.get(id) ?? null;
  }

  async obterPorOrdemServico(ordemServicoId: string): Promise<Orcamento | null> {
    return (
      [...this.registros.values()].find(
        (orcamento) => orcamento.ordemServicoId === ordemServicoId,
      ) ?? null
    );
  }

  async obterPorSaga(sagaId: string): Promise<Orcamento | null> {
    return (
      [...this.registros.values()].find(
        (orcamento) => orcamento.sagaId === sagaId,
      ) ?? null
    );
  }

  async listar(status?: StatusOrcamento): Promise<Orcamento[]> {
    const todos = [...this.registros.values()];
    return status
      ? todos.filter((orcamento) => orcamento.status === status)
      : todos;
  }

  limpar() {
    this.registros.clear();
  }
}
