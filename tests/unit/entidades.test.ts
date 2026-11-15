import Orcamento, { StatusOrcamento } from "../../domain/entity/Orcamento";
import ItemOrcamento, { TipoItem } from "../../domain/entity/ItemOrcamento";
import Pagamento, {
  MeioPagamento,
  StatusPagamento,
} from "../../domain/entity/Pagamento";
import ErroDominio from "../../domain/ErroDominio";
import ID from "../../domain/vo/ID";

function itens(): ItemOrcamento[] {
  return [
    new ItemOrcamento({
      referenciaId: "srv-revisao",
      descricao: "Revisao completa",
      tipo: TipoItem.SERVICO,
      quantidade: 1,
      valorUnitario: 450,
    }),
    new ItemOrcamento({
      referenciaId: "pec-filtro-oleo",
      descricao: "Filtro de oleo",
      tipo: "peca",
      quantidade: 2,
      valorUnitario: 65.5,
    }),
  ];
}

function novoOrcamento(): Orcamento {
  return new Orcamento({
    ordemServicoId: "os-1",
    clienteId: "cliente-1",
    veiculoId: "veiculo-1",
    sagaId: "saga-1",
    clienteEmail: "cliente@oficina.local",
    itens: itens(),
  });
}

function novoPagamento(valor = 581): Pagamento {
  return new Pagamento({
    orcamentoId: "orc-1",
    ordemServicoId: "os-1",
    clienteId: "cliente-1",
    sagaId: "saga-1",
    valor,
  });
}

describe("ItemOrcamento", () => {
  it("normaliza o tipo informado em minusculas", () => {
    expect(itens()[1].tipo).toBe(TipoItem.PECA);
  });

  it("calcula o total do item", () => {
    expect(itens()[1].getTotal()).toBe(131);
  });

  it("compara dois itens por valor", () => {
    const [primeiro] = itens();
    expect(primeiro.igual(itens()[0])).toBe(true);
    expect(primeiro.igual(itens()[1])).toBe(false);
  });

  it.each([
    ["descricao vazia", { descricao: "  ", quantidade: 1, valorUnitario: 10 }],
    ["quantidade zero", { descricao: "Item", quantidade: 0, valorUnitario: 10 }],
    ["valor negativo", { descricao: "Item", quantidade: 1, valorUnitario: -1 }],
    ["tipo desconhecido", { descricao: "Item", quantidade: 1, valorUnitario: 10, tipo: "OUTRO" }],
  ])("rejeita %s", (_caso, dados) => {
    expect(
      () =>
        new ItemOrcamento({
          referenciaId: "x",
          tipo: TipoItem.PECA,
          ...dados,
        } as never),
    ).toThrow(ErroDominio);
  });
});

describe("Orcamento", () => {
  it("nasce GERADO e calcula o total dos itens", () => {
    const orcamento = novoOrcamento();

    expect(orcamento.status).toBe(StatusOrcamento.GERADO);
    // 450 + (2 x 65,50) = 581,00
    expect(orcamento.valorTotal).toBe(581);
  });

  it("exige ordem de servico e ao menos um item", () => {
    expect(
      () =>
        new Orcamento({
          ordemServicoId: "",
          clienteId: "c",
          veiculoId: "v",
          sagaId: "s",
          itens: itens(),
        }),
    ).toThrow(ErroDominio);

    expect(
      () =>
        new Orcamento({
          ordemServicoId: "os-1",
          clienteId: "c",
          veiculoId: "v",
          sagaId: "s",
          itens: [],
        }),
    ).toThrow(ErroDominio);
  });

  it("aprova e recusa apenas a partir de GERADO", () => {
    const aprovado = novoOrcamento();
    aprovado.aprovar();
    expect(aprovado.status).toBe(StatusOrcamento.APROVADO);
    expect(() => aprovado.aprovar()).toThrow(ErroDominio);

    const recusado = novoOrcamento();
    recusado.recusar("Cliente achou caro");
    expect(recusado.status).toBe(StatusOrcamento.RECUSADO);
    expect(recusado.motivoCancelamento).toBe("Cliente achou caro");
    expect(() => recusado.recusar()).toThrow(ErroDominio);
  });

  // A compensacao precisa ser idempotente: o broker entrega ao menos uma vez.
  it("cancelar e idempotente e preserva o registro no historico", () => {
    const orcamento = novoOrcamento();

    orcamento.cancelar("Pagamento falhou");
    const atualizadoEm = orcamento.atualizadoEm;

    orcamento.cancelar("Outro motivo");

    expect(orcamento.status).toBe(StatusOrcamento.CANCELADO);
    expect(orcamento.motivoCancelamento).toBe("Pagamento falhou");
    expect(orcamento.atualizadoEm).toBe(atualizadoEm);
    expect(orcamento.estaCancelado()).toBe(true);
  });

  it("cancela mesmo um orcamento ja aprovado", () => {
    const orcamento = novoOrcamento();
    orcamento.aprovar();
    orcamento.cancelar("Execucao falhou");

    expect(orcamento.status).toBe(StatusOrcamento.CANCELADO);
  });

  it("aceita valor total e identificador ja persistidos (reidratacao)", () => {
    const orcamento = new Orcamento({
      id: new ID("11111111-1111-4111-8111-111111111111"),
      ordemServicoId: "os-1",
      clienteId: "c",
      veiculoId: "v",
      sagaId: "s",
      itens: itens(),
      valorTotal: 999,
      status: StatusOrcamento.APROVADO,
    });

    expect(orcamento.id.getValue()).toBe("11111111-1111-4111-8111-111111111111");
    expect(orcamento.valorTotal).toBe(999);
    expect(orcamento.status).toBe(StatusOrcamento.APROVADO);
  });
});

describe("Pagamento", () => {
  it("nasce PENDENTE com Pix como meio padrao", () => {
    const pagamento = novoPagamento();

    expect(pagamento.status).toBe(StatusPagamento.PENDENTE);
    expect(pagamento.meio).toBe(MeioPagamento.PIX);
  });

  it.each([
    ["orcamento ausente", { orcamentoId: "", valor: 10 }],
    ["valor zero", { orcamentoId: "orc-1", valor: 0 }],
    ["valor negativo", { orcamentoId: "orc-1", valor: -5 }],
  ])("rejeita %s", (_caso, dados) => {
    expect(
      () =>
        new Pagamento({
          ordemServicoId: "os-1",
          clienteId: "c",
          sagaId: "s",
          ...dados,
        }),
    ).toThrow(ErroDominio);
  });

  it("rejeita meio de pagamento desconhecido", () => {
    expect(() => novoPagamentoComMeio("CRIPTO")).toThrow(ErroDominio);
  });

  function novoPagamentoComMeio(meio: string) {
    return new Pagamento({
      orcamentoId: "orc-1",
      ordemServicoId: "os-1",
      clienteId: "c",
      sagaId: "s",
      valor: 10,
      meio,
    });
  }

  it("aceita cartao e boleto", () => {
    expect(novoPagamentoComMeio("cartao_credito").meio).toBe(
      MeioPagamento.CARTAO_CREDITO,
    );
    expect(novoPagamentoComMeio("BOLETO").meio).toBe(MeioPagamento.BOLETO);
  });

  it("aprova guardando o identificador externo e o QR Code", () => {
    const pagamento = novoPagamento();
    pagamento.aprovar("mp-123", "qr-code-pix");

    expect(pagamento.estaAprovado()).toBe(true);
    expect(pagamento.idExterno).toBe("mp-123");
    expect(pagamento.qrCode).toBe("qr-code-pix");
  });

  it("aprovar e idempotente", () => {
    const pagamento = novoPagamento();
    pagamento.aprovar("mp-123");
    pagamento.aprovar("mp-999");

    expect(pagamento.idExterno).toBe("mp-123");
  });

  it("nao aprova um pagamento ja estornado", () => {
    const pagamento = novoPagamento();
    pagamento.aprovar("mp-123");
    pagamento.estornar("rollback");

    expect(() => pagamento.aprovar("mp-123")).toThrow(ErroDominio);
  });

  it("registra a recusa com o motivo", () => {
    const pagamento = novoPagamento();
    pagamento.recusar("Cartao sem limite");

    expect(pagamento.status).toBe(StatusPagamento.RECUSADO);
    expect(pagamento.motivoRecusa).toBe("Cartao sem limite");
  });

  // Estornar duas vezes devolveria dinheiro em dobro: a idempotencia aqui tem
  // consequencia financeira direta.
  it("estorno e idempotente", () => {
    const pagamento = novoPagamento();
    pagamento.aprovar("mp-123");

    pagamento.estornar("Execucao falhou");
    const atualizadoEm = pagamento.atualizadoEm;
    pagamento.estornar("Outro motivo");

    expect(pagamento.estaEstornado()).toBe(true);
    expect(pagamento.motivoEstorno).toBe("Execucao falhou");
    expect(pagamento.atualizadoEm).toBe(atualizadoEm);
  });

  // Nao houve cobranca: nao ha o que devolver, apenas recusar.
  it("estornar um pagamento PENDENTE apenas o recusa", () => {
    const pagamento = novoPagamento();
    pagamento.estornar("Saga compensada");

    expect(pagamento.status).toBe(StatusPagamento.RECUSADO);
    expect(pagamento.estaEstornado()).toBe(false);
  });

  it("arredonda o valor para duas casas", () => {
    expect(novoPagamento(10.129).valor).toBe(10.13);
  });
});
