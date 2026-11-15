import { Collection } from "mongodb";
import Pagamento, {
  MeioPagamento,
  StatusPagamento,
} from "../../entity/Pagamento";
import ID from "../../vo/ID";
import PagamentoRepository from "../PagamentoRepository";

export type DocumentoPagamento = {
  _id: string;
  orcamentoId: string;
  ordemServicoId: string;
  clienteId: string;
  sagaId: string;
  valor: number;
  meio: MeioPagamento;
  status: StatusPagamento;
  idExterno?: string;
  qrCode?: string;
  motivoRecusa?: string;
  motivoEstorno?: string;
  criadoEm: Date;
  atualizadoEm: Date;
};

export default class PagamentoRepositoryMongo implements PagamentoRepository {
  constructor(private readonly colecao: Collection<DocumentoPagamento>) {}

  async salvar(pagamento: Pagamento): Promise<void> {
    await this.colecao.insertOne(this.paraDocumento(pagamento));
  }

  async atualizar(pagamento: Pagamento): Promise<void> {
    const { _id, ...campos } = this.paraDocumento(pagamento);
    await this.colecao.updateOne({ _id }, { $set: campos }, { upsert: true });
  }

  async obter(id: string): Promise<Pagamento | null> {
    const documento = await this.colecao.findOne({ _id: id });
    return documento ? this.hidratar(documento) : null;
  }

  async obterPorOrcamento(orcamentoId: string): Promise<Pagamento | null> {
    const documento = await this.colecao.findOne(
      { orcamentoId },
      { sort: { criadoEm: -1 } },
    );
    return documento ? this.hidratar(documento) : null;
  }

  async obterPorOrdemServico(ordemServicoId: string): Promise<Pagamento | null> {
    const documento = await this.colecao.findOne(
      { ordemServicoId },
      { sort: { criadoEm: -1 } },
    );
    return documento ? this.hidratar(documento) : null;
  }

  async obterPorSaga(sagaId: string): Promise<Pagamento | null> {
    const documento = await this.colecao.findOne(
      { sagaId },
      { sort: { criadoEm: -1 } },
    );
    return documento ? this.hidratar(documento) : null;
  }

  async listar(status?: StatusPagamento): Promise<Pagamento[]> {
    const filtro = status ? { status } : {};
    const documentos = await this.colecao
      .find(filtro)
      .sort({ criadoEm: -1 })
      .limit(Number(process.env.LIMITE_LISTAGEM || 200))
      .toArray();

    return documentos.map((documento) => this.hidratar(documento));
  }

  private paraDocumento(pagamento: Pagamento): DocumentoPagamento {
    return {
      _id: pagamento.id.getValue(),
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
      criadoEm: pagamento.criadoEm,
      atualizadoEm: pagamento.atualizadoEm,
    };
  }

  private hidratar(documento: DocumentoPagamento): Pagamento {
    return new Pagamento({
      id: new ID(documento._id),
      orcamentoId: documento.orcamentoId,
      ordemServicoId: documento.ordemServicoId,
      clienteId: documento.clienteId,
      sagaId: documento.sagaId,
      valor: documento.valor,
      meio: documento.meio,
      status: documento.status,
      idExterno: documento.idExterno,
      qrCode: documento.qrCode,
      motivoRecusa: documento.motivoRecusa,
      motivoEstorno: documento.motivoEstorno,
      criadoEm: new Date(documento.criadoEm),
      atualizadoEm: new Date(documento.atualizadoEm),
    });
  }
}
