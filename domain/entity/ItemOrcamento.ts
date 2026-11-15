import ErroDominio from "../ErroDominio";

export enum TipoItem {
  SERVICO = "SERVICO",
  PECA = "PECA",
  INSUMO = "INSUMO",
}

// Objeto de valor: itens do orcamento nao tem identidade propria, apenas
// valor. Dois itens com os mesmos atributos sao equivalentes.
export default class ItemOrcamento {
  readonly referenciaId: string;
  readonly descricao: string;
  readonly tipo: TipoItem;
  readonly quantidade: number;
  readonly valorUnitario: number;

  constructor(dados: {
    referenciaId: string;
    descricao: string;
    tipo: TipoItem | string;
    quantidade: number;
    valorUnitario: number;
  }) {
    if (!dados.descricao || dados.descricao.trim().length === 0) {
      throw new ErroDominio(
        "item.descricao.obrigatoria",
        "Descricao do item e obrigatoria.",
      );
    }
    if (!Number.isFinite(dados.quantidade) || dados.quantidade <= 0) {
      throw new ErroDominio(
        "item.quantidade.invalida",
        "Quantidade do item deve ser maior que zero.",
      );
    }
    if (!Number.isFinite(dados.valorUnitario) || dados.valorUnitario < 0) {
      throw new ErroDominio(
        "item.valor.invalido",
        "Valor unitario do item nao pode ser negativo.",
      );
    }

    const tipo = String(dados.tipo).toUpperCase() as TipoItem;
    if (!Object.values(TipoItem).includes(tipo)) {
      throw new ErroDominio(
        "item.tipo.invalido",
        `Tipo de item invalido: ${dados.tipo}.`,
      );
    }

    this.referenciaId = dados.referenciaId;
    this.descricao = dados.descricao.trim();
    this.tipo = tipo;
    this.quantidade = dados.quantidade;
    this.valorUnitario = dados.valorUnitario;
  }

  getTotal(): number {
    return Number((this.quantidade * this.valorUnitario).toFixed(2));
  }

  igual(outro: ItemOrcamento): boolean {
    return (
      this.referenciaId === outro.referenciaId &&
      this.quantidade === outro.quantidade &&
      this.valorUnitario === outro.valorUnitario
    );
  }
}
