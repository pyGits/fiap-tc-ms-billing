import Pagamento, { StatusPagamento } from "../entity/Pagamento";

export default interface PagamentoRepository {
  salvar(pagamento: Pagamento): Promise<void>;
  atualizar(pagamento: Pagamento): Promise<void>;
  obter(id: string): Promise<Pagamento | null>;
  obterPorOrcamento(orcamentoId: string): Promise<Pagamento | null>;
  obterPorOrdemServico(ordemServicoId: string): Promise<Pagamento | null>;
  obterPorSaga(sagaId: string): Promise<Pagamento | null>;
  listar(status?: StatusPagamento): Promise<Pagamento[]>;
}
