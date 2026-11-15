import { Collection } from "mongodb";
import Orcamento, { StatusOrcamento } from "../../entity/Orcamento";
import ItemOrcamento, { TipoItem } from "../../entity/ItemOrcamento";
import ID from "../../vo/ID";
import OrcamentoRepository from "../OrcamentoRepository";

// Documento como ele fica no MongoDB.
//
// O _id e o proprio UUID do agregado (string), nao um ObjectId: o identificador
// e gerado pelo dominio e viaja nas mensagens da Saga, portanto precisa ser o
// mesmo em todos os servicos.
export type DocumentoOrcamento = {
  _id: string;
  ordemServicoId: string;
  clienteId: string;
  clienteEmail?: string;
  veiculoId: string;
  sagaId: string;
  status: StatusOrcamento;
  valorTotal: number;
  // Itens EMBUTIDOS no documento: o orcamento e lido e gravado sempre por
  // inteiro, nunca por juncao. Esta e a razao de usar um banco de documentos.
  itens: Array<{
    referenciaId: string;
    descricao: string;
    tipo: TipoItem;
    quantidade: number;
    valorUnitario: number;
  }>;
  motivoCancelamento?: string;
  criadoEm: Date;
  atualizadoEm: Date;
};

export default class OrcamentoRepositoryMongo implements OrcamentoRepository {
  constructor(private readonly colecao: Collection<DocumentoOrcamento>) {}

  async salvar(orcamento: Orcamento): Promise<void> {
    await this.colecao.insertOne(this.paraDocumento(orcamento));
  }

  async atualizar(orcamento: Orcamento): Promise<void> {
    const documento = this.paraDocumento(orcamento);
    const { _id, ...campos } = documento;

    // upsert: a compensacao pode chegar antes de uma eventual reescrita, e um
    // update que nao encontra o documento nao deve falhar silenciosamente.
    await this.colecao.updateOne({ _id }, { $set: campos }, { upsert: true });
  }

  async obter(id: string): Promise<Orcamento | null> {
    const documento = await this.colecao.findOne({ _id: id });
    return documento ? this.hidratar(documento) : null;
  }

  async obterPorOrdemServico(ordemServicoId: string): Promise<Orcamento | null> {
    const documento = await this.colecao.findOne(
      { ordemServicoId },
      { sort: { criadoEm: -1 } },
    );
    return documento ? this.hidratar(documento) : null;
  }

  async obterPorSaga(sagaId: string): Promise<Orcamento | null> {
    const documento = await this.colecao.findOne(
      { sagaId },
      { sort: { criadoEm: -1 } },
    );
    return documento ? this.hidratar(documento) : null;
  }

  async listar(status?: StatusOrcamento): Promise<Orcamento[]> {
    const filtro = status ? { status } : {};
    const documentos = await this.colecao
      .find(filtro)
      .sort({ criadoEm: -1 })
      .limit(Number(process.env.LIMITE_LISTAGEM || 200))
      .toArray();

    return documentos.map((documento) => this.hidratar(documento));
  }

  private paraDocumento(orcamento: Orcamento): DocumentoOrcamento {
    return {
      _id: orcamento.id.getValue(),
      ordemServicoId: orcamento.ordemServicoId,
      clienteId: orcamento.clienteId,
      clienteEmail: orcamento.clienteEmail,
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
      })),
      motivoCancelamento: orcamento.motivoCancelamento,
      criadoEm: orcamento.criadoEm,
      atualizadoEm: orcamento.atualizadoEm,
    };
  }

  private hidratar(documento: DocumentoOrcamento): Orcamento {
    return new Orcamento({
      id: new ID(documento._id),
      ordemServicoId: documento.ordemServicoId,
      clienteId: documento.clienteId,
      clienteEmail: documento.clienteEmail,
      veiculoId: documento.veiculoId,
      sagaId: documento.sagaId,
      status: documento.status,
      valorTotal: documento.valorTotal,
      motivoCancelamento: documento.motivoCancelamento,
      criadoEm: new Date(documento.criadoEm),
      atualizadoEm: new Date(documento.atualizadoEm),
      itens: documento.itens.map(
        (item) =>
          new ItemOrcamento({
            referenciaId: item.referenciaId,
            descricao: item.descricao,
            tipo: item.tipo,
            quantidade: item.quantidade,
            valorUnitario: item.valorUnitario,
          }),
      ),
    });
  }
}
