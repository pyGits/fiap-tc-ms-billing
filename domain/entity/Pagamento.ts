import ErroDominio from "../ErroDominio";
import ID from "../vo/ID";

export enum StatusPagamento {
  PENDENTE = "PENDENTE",
  APROVADO = "APROVADO",
  RECUSADO = "RECUSADO",
  // Estado produzido pela transacao compensatoria ESTORNAR_PAGAMENTO.
  ESTORNADO = "ESTORNADO",
}

export enum MeioPagamento {
  PIX = "PIX",
  CARTAO_CREDITO = "CARTAO_CREDITO",
  BOLETO = "BOLETO",
}

export default class Pagamento {
  readonly id: ID;
  readonly orcamentoId: string;
  readonly ordemServicoId: string;
  readonly clienteId: string;
  readonly sagaId: string;
  readonly valor: number;
  readonly meio: MeioPagamento;

  status: StatusPagamento;
  // Identificador do pagamento no Mercado Pago.
  idExterno?: string;
  qrCode?: string;
  motivoRecusa?: string;
  motivoEstorno?: string;
  criadoEm: Date;
  atualizadoEm: Date;

  constructor(dados: {
    id?: ID;
    orcamentoId: string;
    ordemServicoId: string;
    clienteId: string;
    sagaId: string;
    valor: number;
    meio?: MeioPagamento | string;
    status?: StatusPagamento;
    idExterno?: string;
    qrCode?: string;
    motivoRecusa?: string;
    motivoEstorno?: string;
    criadoEm?: Date;
    atualizadoEm?: Date;
  }) {
    if (!dados.orcamentoId) {
      throw new ErroDominio(
        "pagamento.orcamento.obrigatorio",
        "Pagamento precisa referenciar um orcamento.",
      );
    }
    if (!Number.isFinite(dados.valor) || dados.valor <= 0) {
      throw new ErroDominio(
        "pagamento.valor.invalido",
        "Valor do pagamento deve ser maior que zero.",
      );
    }

    const meio = String(dados.meio ?? MeioPagamento.PIX).toUpperCase() as MeioPagamento;
    if (!Object.values(MeioPagamento).includes(meio)) {
      throw new ErroDominio(
        "pagamento.meio.invalido",
        `Meio de pagamento invalido: ${dados.meio}.`,
      );
    }

    this.id = dados.id ?? new ID();
    this.orcamentoId = dados.orcamentoId;
    this.ordemServicoId = dados.ordemServicoId;
    this.clienteId = dados.clienteId;
    this.sagaId = dados.sagaId;
    this.valor = Number(dados.valor.toFixed(2));
    this.meio = meio;
    this.status = dados.status ?? StatusPagamento.PENDENTE;
    this.idExterno = dados.idExterno;
    this.qrCode = dados.qrCode;
    this.motivoRecusa = dados.motivoRecusa;
    this.motivoEstorno = dados.motivoEstorno;
    this.criadoEm = dados.criadoEm ?? new Date();
    this.atualizadoEm = dados.atualizadoEm ?? new Date();
  }

  aprovar(idExterno?: string, qrCode?: string) {
    if (this.status === StatusPagamento.APROVADO) return;

    if (this.status === StatusPagamento.ESTORNADO) {
      throw new ErroDominio(
        "pagamento.estornado",
        "Um pagamento estornado nao pode ser aprovado novamente.",
        409,
      );
    }

    this.status = StatusPagamento.APROVADO;
    if (idExterno) this.idExterno = idExterno;
    if (qrCode) this.qrCode = qrCode;
    this.atualizadoEm = new Date();
  }

  recusar(motivo: string) {
    this.status = StatusPagamento.RECUSADO;
    this.motivoRecusa = motivo;
    this.atualizadoEm = new Date();
  }

  // Transacao compensatoria de REGISTRAR_PAGAMENTO.
  //
  // Idempotente por dois motivos: a mensagem pode ser reentregue pelo broker e
  // estornar duas vezes o mesmo pagamento devolveria dinheiro em dobro - o
  // exemplo classico de por que compensacao nao e "rollback de banco".
  estornar(motivo: string) {
    if (this.status === StatusPagamento.ESTORNADO) return;

    if (this.status === StatusPagamento.PENDENTE) {
      // Nunca foi cobrado: nao ha o que devolver, apenas recusar.
      this.status = StatusPagamento.RECUSADO;
      this.motivoRecusa = motivo;
      this.atualizadoEm = new Date();
      return;
    }

    this.status = StatusPagamento.ESTORNADO;
    this.motivoEstorno = motivo;
    this.atualizadoEm = new Date();
  }

  estaAprovado(): boolean {
    return this.status === StatusPagamento.APROVADO;
  }

  estaEstornado(): boolean {
    return this.status === StatusPagamento.ESTORNADO;
  }
}
