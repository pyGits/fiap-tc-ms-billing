import Pagamento, { StatusPagamento } from "../../entity/Pagamento";
import PagamentoRepository from "../PagamentoRepository";

export default class PagamentoRepositoryMemoria implements PagamentoRepository {
  private readonly registros = new Map<string, Pagamento>();

  async salvar(pagamento: Pagamento): Promise<void> {
    this.registros.set(pagamento.id.getValue(), pagamento);
  }

  async atualizar(pagamento: Pagamento): Promise<void> {
    this.registros.set(pagamento.id.getValue(), pagamento);
  }

  async obter(id: string): Promise<Pagamento | null> {
    return this.registros.get(id) ?? null;
  }

  async obterPorOrcamento(orcamentoId: string): Promise<Pagamento | null> {
    return (
      [...this.registros.values()].find(
        (pagamento) => pagamento.orcamentoId === orcamentoId,
      ) ?? null
    );
  }

  async obterPorOrdemServico(ordemServicoId: string): Promise<Pagamento | null> {
    return (
      [...this.registros.values()].find(
        (pagamento) => pagamento.ordemServicoId === ordemServicoId,
      ) ?? null
    );
  }

  async obterPorSaga(sagaId: string): Promise<Pagamento | null> {
    return (
      [...this.registros.values()].find(
        (pagamento) => pagamento.sagaId === sagaId,
      ) ?? null
    );
  }

  async listar(status?: StatusPagamento): Promise<Pagamento[]> {
    const todos = [...this.registros.values()];
    return status
      ? todos.filter((pagamento) => pagamento.status === status)
      : todos;
  }

  limpar() {
    this.registros.clear();
  }
}
