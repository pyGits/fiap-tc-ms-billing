import Orcamento, { StatusOrcamento } from "../entity/Orcamento";

export default interface OrcamentoRepository {
  salvar(orcamento: Orcamento): Promise<void>;
  atualizar(orcamento: Orcamento): Promise<void>;
  obter(id: string): Promise<Orcamento | null>;
  // Um orcamento por ordem de servico: a consulta por OS e o caminho usado
  // pelas compensacoes, que podem chegar sem o id do orcamento.
  obterPorOrdemServico(ordemServicoId: string): Promise<Orcamento | null>;
  obterPorSaga(sagaId: string): Promise<Orcamento | null>;
  listar(status?: StatusOrcamento): Promise<Orcamento[]>;
}
