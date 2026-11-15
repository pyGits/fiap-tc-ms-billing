import ErroDominio from "../../ErroDominio";
import Pagamento, { StatusPagamento } from "../../entity/Pagamento";
import PagamentoRepository from "../../repository/PagamentoRepository";

export type PagamentoApresentado = {
  id: string;
  orcamentoId: string;
  ordemServicoId: string;
  clienteId: string;
  sagaId: string;
  valor: number;
  meio: string;
  status: string;
  idExterno?: string;
  qrCode?: string;
  motivoRecusa?: string;
  motivoEstorno?: string;
  criadoEm: string;
  atualizadoEm: string;
};

export default class ConsultarPagamentoUseCase {
  constructor(private readonly pagamentoRepository: PagamentoRepository) {}

  async porId(id: string): Promise<PagamentoApresentado> {
    const pagamento = await this.pagamentoRepository.obter(id);
    if (!pagamento) {
      throw ErroDominio.naoEncontrado(
        "pagamento.nao.encontrado",
        "Pagamento nao encontrado.",
      );
    }
    return this.apresentar(pagamento);
  }

  async porOrdemServico(ordemServicoId: string): Promise<PagamentoApresentado> {
    const pagamento =
      await this.pagamentoRepository.obterPorOrdemServico(ordemServicoId);
    if (!pagamento) {
      throw ErroDominio.naoEncontrado(
        "pagamento.nao.encontrado",
        "Nao existe pagamento para esta ordem de servico.",
      );
    }
    return this.apresentar(pagamento);
  }

  async listar(status?: string): Promise<PagamentoApresentado[]> {
    const filtro = status
      ? (status.toUpperCase() as StatusPagamento)
      : undefined;
    const pagamentos = await this.pagamentoRepository.listar(filtro);
    return pagamentos.map((pagamento) => this.apresentar(pagamento));
  }

  private apresentar(pagamento: Pagamento): PagamentoApresentado {
    return {
      id: pagamento.id.getValue(),
      orcamentoId: pagamento.orcamentoId,
      ordemServicoId: pagamento.ordemServicoId,
      clienteId: pagamento.clienteId,
      sagaId: pagamento.sagaId,
      valor: pagamento.valor,
      meio: pagamento.meio,
      status: pagamento.status,
      idExterno: pagamento.idExterno,
      qrCode: pagamento.qrCode,
      motivoRecusa: pagamento.motivoRecusa,
      motivoEstorno: pagamento.motivoEstorno,
      criadoEm: pagamento.criadoEm.toISOString(),
      atualizadoEm: pagamento.atualizadoEm.toISOString(),
    };
  }
}
