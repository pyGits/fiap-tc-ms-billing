import ErroDominio from "../ErroDominio";
import ID from "../vo/ID";
import ItemOrcamento from "./ItemOrcamento";

// Ciclo de vida do orcamento dentro do contexto de Billing.
//
// Observe que nao existe aqui o status "AGUARDANDO_APROVACAO": quem controla a
// decisao do cliente e o OS Service. O Billing so sabe gerar, aprovar, recusar
// e cancelar - cada contexto delimitado modela apenas o que e seu.
export enum StatusOrcamento {
  GERADO = "GERADO",
  APROVADO = "APROVADO",
  RECUSADO = "RECUSADO",
  // Estado produzido pela transacao compensatoria CANCELAR_ORCAMENTO.
  CANCELADO = "CANCELADO",
}

export default class Orcamento {
  readonly id: ID;
  readonly ordemServicoId: string;
  readonly clienteId: string;
  readonly veiculoId: string;
  readonly sagaId: string;

  itens: ItemOrcamento[];
  valorTotal: number;
  status: StatusOrcamento;
  clienteEmail?: string;
  motivoCancelamento?: string;
  criadoEm: Date;
  atualizadoEm: Date;

  constructor(dados: {
    id?: ID;
    ordemServicoId: string;
    clienteId: string;
    veiculoId: string;
    sagaId: string;
    itens: ItemOrcamento[];
    clienteEmail?: string;
    status?: StatusOrcamento;
    valorTotal?: number;
    motivoCancelamento?: string;
    criadoEm?: Date;
    atualizadoEm?: Date;
  }) {
    if (!dados.ordemServicoId) {
      throw new ErroDominio(
        "orcamento.os.obrigatoria",
        "Orcamento precisa referenciar uma ordem de servico.",
      );
    }
    if (!dados.itens || dados.itens.length === 0) {
      throw new ErroDominio(
        "orcamento.itens.obrigatorios",
        "Orcamento precisa de ao menos um item.",
      );
    }

    this.id = dados.id ?? new ID();
    this.ordemServicoId = dados.ordemServicoId;
    this.clienteId = dados.clienteId;
    this.veiculoId = dados.veiculoId;
    this.sagaId = dados.sagaId;
    this.itens = dados.itens;
    this.clienteEmail = dados.clienteEmail;
    this.status = dados.status ?? StatusOrcamento.GERADO;
    this.motivoCancelamento = dados.motivoCancelamento;
    this.criadoEm = dados.criadoEm ?? new Date();
    this.atualizadoEm = dados.atualizadoEm ?? new Date();
    this.valorTotal = dados.valorTotal ?? this.calcularTotal();
  }

  calcularTotal(): number {
    this.valorTotal = Number(
      this.itens
        .reduce((acumulado, item) => acumulado + item.getTotal(), 0)
        .toFixed(2),
    );
    return this.valorTotal;
  }

  aprovar() {
    this.exigirStatus(
      [StatusOrcamento.GERADO],
      "Somente um orcamento gerado pode ser aprovado.",
    );
    this.status = StatusOrcamento.APROVADO;
    this.atualizadoEm = new Date();
  }

  recusar(motivo?: string) {
    this.exigirStatus(
      [StatusOrcamento.GERADO],
      "Somente um orcamento gerado pode ser recusado.",
    );
    this.status = StatusOrcamento.RECUSADO;
    this.motivoCancelamento = motivo;
    this.atualizadoEm = new Date();
  }

  // Transacao compensatoria de GERAR_ORCAMENTO.
  //
  // Precisa ser IDEMPOTENTE: o RabbitMQ entrega ao menos uma vez, e o
  // orquestrador pode reenviar a compensacao. Cancelar o que ja esta cancelado
  // nao e erro - e um no-op.
  cancelar(motivo: string) {
    if (this.status === StatusOrcamento.CANCELADO) return;

    this.status = StatusOrcamento.CANCELADO;
    this.motivoCancelamento = motivo;
    this.atualizadoEm = new Date();
  }

  estaCancelado(): boolean {
    return this.status === StatusOrcamento.CANCELADO;
  }

  private exigirStatus(permitidos: StatusOrcamento[], mensagem: string) {
    if (!permitidos.includes(this.status)) {
      throw new ErroDominio("orcamento.status.invalido", mensagem, 409);
    }
  }
}
