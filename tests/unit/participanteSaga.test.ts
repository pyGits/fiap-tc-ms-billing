import { StatusOrcamento } from "../../domain/entity/Orcamento";
import { StatusPagamento } from "../../domain/entity/Pagamento";
import MensageriaGatewayMemoria from "../../domain/gateway/Mock/MensageriaGatewayMemoria";
import PagamentoExternoGatewayMemoria from "../../domain/gateway/Mock/PagamentoExternoGatewayMemoria";
import { criarContainer, Container } from "../../src/container";
import { TipoResposta } from "../../src/messaging/contracts";

const CTX = { sagaId: "saga-1", ordemServicoId: "os-1" };

const ITENS = [
  {
    id: "srv-revisao",
    descricao: "Revisao completa",
    quantidade: 1,
    valorUnitario: 450,
    tipo: "SERVICO",
  },
  {
    id: "pec-filtro-oleo",
    descricao: "Filtro de oleo",
    quantidade: 2,
    valorUnitario: 65.5,
    tipo: "PECA",
  },
];

type Cenario = {
  container: Container;
  mensageria: MensageriaGatewayMemoria;
  provedor: PagamentoExternoGatewayMemoria;
};

function montar(): Cenario {
  const container = criarContainer();
  return {
    container,
    mensageria: container.mensageria as MensageriaGatewayMemoria,
    provedor: container.pagamentoExterno as PagamentoExternoGatewayMemoria,
  };
}

async function gerarOrcamento(cenario: Cenario) {
  const orcamento = await cenario.container.gerarOrcamento.execute({
    ...CTX,
    clienteId: "cliente-1",
    clienteEmail: "cliente@oficina.local",
    veiculoId: "veiculo-1",
    itens: ITENS,
  });
  return orcamento!;
}

describe("GerarOrcamentoUseCase (passo 2 da Saga)", () => {
  it("grava o orcamento e responde ORCAMENTO_GERADO", async () => {
    const cenario = montar();

    const orcamento = await gerarOrcamento(cenario);

    expect(orcamento.valorTotal).toBe(581);
    expect(cenario.mensageria.tipos()).toEqual([TipoResposta.ORCAMENTO_GERADO]);
    expect(cenario.mensageria.ultima()?.body).toEqual({
      orcamentoId: orcamento.id.getValue(),
      valorTotal: 581,
    });

    const persistido = await cenario.container.orcamentoRepository.obterPorSaga(
      "saga-1",
    );
    expect(persistido?.id.getValue()).toBe(orcamento.id.getValue());
  });

  // Reentrega da mesma mensagem nao pode gerar um segundo orcamento.
  it("e idempotente por Saga: repete a resposta sem duplicar o agregado", async () => {
    const cenario = montar();

    const primeiro = await gerarOrcamento(cenario);
    const segundo = await gerarOrcamento(cenario);

    expect(segundo.id.getValue()).toBe(primeiro.id.getValue());
    expect(await cenario.container.orcamentoRepository.listar()).toHaveLength(1);
    expect(cenario.mensageria.tipos()).toEqual([
      TipoResposta.ORCAMENTO_GERADO,
      TipoResposta.ORCAMENTO_GERADO,
    ]);
  });

  // Sem resposta de falha, a Saga ficaria pendurada para sempre.
  it("responde ORCAMENTO_FALHOU quando a transacao local falha", async () => {
    const cenario = montar();

    const resultado = await cenario.container.gerarOrcamento.execute({
      ...CTX,
      clienteId: "cliente-1",
      veiculoId: "veiculo-1",
      // Item invalido: quantidade zero e rejeitada pelo objeto de valor.
      itens: [{ ...ITENS[0], quantidade: 0 }],
    });

    expect(resultado).toBeNull();
    expect(cenario.mensageria.tipos()).toEqual([TipoResposta.ORCAMENTO_FALHOU]);
    expect(String(cenario.mensageria.ultima()?.body.motivo)).toContain(
      "Quantidade",
    );
  });

  it("gera um novo orcamento quando o anterior foi cancelado", async () => {
    const cenario = montar();

    const primeiro = await gerarOrcamento(cenario);
    await cenario.container.cancelarOrcamento.execute({
      ...CTX,
      orcamentoId: primeiro.id.getValue(),
      motivo: "rollback anterior",
    });

    const segundo = await gerarOrcamento(cenario);
    expect(segundo.id.getValue()).not.toBe(primeiro.id.getValue());
  });
});

describe("CancelarOrcamentoUseCase (compensacao)", () => {
  it("cancela o orcamento e confirma a compensacao", async () => {
    const cenario = montar();
    const orcamento = await gerarOrcamento(cenario);

    await cenario.container.cancelarOrcamento.execute({
      ...CTX,
      orcamentoId: orcamento.id.getValue(),
      motivo: "Pagamento recusado",
    });

    const atualizado = await cenario.container.orcamentoRepository.obter(
      orcamento.id.getValue(),
    );
    expect(atualizado?.status).toBe(StatusOrcamento.CANCELADO);
    expect(cenario.mensageria.tipos()).toContain(
      TipoResposta.ORCAMENTO_CANCELADO,
    );
  });

  it("encontra o orcamento pela Saga quando o id nao vem no comando", async () => {
    const cenario = montar();
    await gerarOrcamento(cenario);

    await cenario.container.cancelarOrcamento.execute({
      ...CTX,
      motivo: "Execucao falhou",
    });

    const atualizado = await cenario.container.orcamentoRepository.obterPorSaga(
      "saga-1",
    );
    expect(atualizado?.estaCancelado()).toBe(true);
  });

  // Uma compensacao que falha deixaria a Saga presa em COMPENSANDO.
  it("nao falha quando nao existe orcamento para compensar", async () => {
    const cenario = montar();

    await expect(
      cenario.container.cancelarOrcamento.execute({
        ...CTX,
        motivo: "nada a desfazer",
      }),
    ).resolves.toBeUndefined();

    expect(cenario.mensageria.tipos()).toEqual([
      TipoResposta.ORCAMENTO_CANCELADO,
    ]);
  });
});

describe("RegistrarPagamentoUseCase (passo 4 da Saga)", () => {
  async function comOrcamento(cenario: Cenario) {
    const orcamento = await gerarOrcamento(cenario);
    cenario.mensageria.limpar();
    return orcamento;
  }

  it("cobra no provedor, aprova o pagamento e responde a Saga", async () => {
    const cenario = montar();
    const orcamento = await comOrcamento(cenario);

    const pagamento = await cenario.container.registrarPagamento.execute({
      ...CTX,
      orcamentoId: orcamento.id.getValue(),
      clienteId: "cliente-1",
      valor: 581,
    });

    expect(pagamento?.estaAprovado()).toBe(true);
    expect(pagamento?.idExterno).toMatch(/^mp-/);
    expect(cenario.mensageria.tipos()).toEqual([
      TipoResposta.PAGAMENTO_REGISTRADO,
    ]);

    // O orcamento tambem passa a APROVADO neste contexto.
    const atualizado = await cenario.container.orcamentoRepository.obter(
      orcamento.id.getValue(),
    );
    expect(atualizado?.status).toBe(StatusOrcamento.APROVADO);
  });

  it("usa o valor do orcamento quando o comando nao informa valor", async () => {
    const cenario = montar();
    const orcamento = await comOrcamento(cenario);

    const pagamento = await cenario.container.registrarPagamento.execute({
      ...CTX,
      orcamentoId: orcamento.id.getValue(),
      clienteId: "cliente-1",
      valor: 0,
    });

    expect(pagamento?.valor).toBe(581);
  });

  it("nao cobra duas vezes pela mesma Saga", async () => {
    const cenario = montar();
    const orcamento = await comOrcamento(cenario);

    const primeiro = await cenario.container.registrarPagamento.execute({
      ...CTX,
      orcamentoId: orcamento.id.getValue(),
      clienteId: "cliente-1",
      valor: 581,
    });
    const segundo = await cenario.container.registrarPagamento.execute({
      ...CTX,
      orcamentoId: orcamento.id.getValue(),
      clienteId: "cliente-1",
      valor: 581,
    });

    expect(segundo?.id.getValue()).toBe(primeiro?.id.getValue());
    expect(cenario.provedor.cobrancas.size).toBe(1);
  });

  it("responde PAGAMENTO_FALHOU quando o orcamento nao existe", async () => {
    const cenario = montar();

    const resultado = await cenario.container.registrarPagamento.execute({
      ...CTX,
      orcamentoId: "orc-inexistente",
      clienteId: "cliente-1",
      valor: 100,
    });

    expect(resultado).toBeNull();
    expect(cenario.mensageria.tipos()).toEqual([TipoResposta.PAGAMENTO_FALHOU]);
    expect(cenario.mensageria.ultima()?.body.codigo).toBe(
      "orcamento.nao.encontrado",
    );
  });

  it("recusa cobrar um orcamento cancelado", async () => {
    const cenario = montar();
    const orcamento = await comOrcamento(cenario);
    await cenario.container.cancelarOrcamento.execute({
      ...CTX,
      orcamentoId: orcamento.id.getValue(),
      motivo: "cancelado antes",
    });
    cenario.mensageria.limpar();

    await cenario.container.registrarPagamento.execute({
      ...CTX,
      orcamentoId: orcamento.id.getValue(),
      clienteId: "cliente-1",
      valor: 581,
    });

    expect(cenario.mensageria.tipos()).toEqual([TipoResposta.PAGAMENTO_FALHOU]);
    expect(cenario.mensageria.ultima()?.body.codigo).toBe("orcamento.cancelado");
  });

  it("marca o pagamento como RECUSADO quando o provedor recusa", async () => {
    const cenario = montar();
    const orcamento = await comOrcamento(cenario);
    cenario.provedor.recusarProximaCobranca = true;

    const resultado = await cenario.container.registrarPagamento.execute({
      ...CTX,
      orcamentoId: orcamento.id.getValue(),
      clienteId: "cliente-1",
      valor: 581,
    });

    expect(resultado).toBeNull();
    expect(cenario.mensageria.tipos()).toEqual([TipoResposta.PAGAMENTO_FALHOU]);

    const pagamento = await cenario.container.pagamentoRepository.obterPorSaga(
      "saga-1",
    );
    expect(pagamento?.status).toBe(StatusPagamento.RECUSADO);
  });

  it("propaga falha de comunicacao com o provedor como PAGAMENTO_FALHOU", async () => {
    const cenario = montar();
    const orcamento = await comOrcamento(cenario);
    cenario.provedor.falharProximaChamada = true;

    await cenario.container.registrarPagamento.execute({
      ...CTX,
      orcamentoId: orcamento.id.getValue(),
      clienteId: "cliente-1",
      valor: 581,
    });

    expect(cenario.mensageria.tipos()).toEqual([TipoResposta.PAGAMENTO_FALHOU]);
  });

  // Gatilho da demonstracao de rollback exigida na Fase 4.
  it("simularFalha forca a recusa controlada do pagamento", async () => {
    const cenario = montar();
    const orcamento = await comOrcamento(cenario);

    const resultado = await cenario.container.registrarPagamento.execute({
      ...CTX,
      orcamentoId: orcamento.id.getValue(),
      clienteId: "cliente-1",
      valor: 581,
      simularFalha: true,
    });

    expect(resultado).toBeNull();
    expect(cenario.mensageria.ultima()?.body.codigo).toBe(
      "pagamento.falha.simulada",
    );
    // A cobranca nunca chegou ao provedor.
    expect(cenario.provedor.cobrancas.size).toBe(0);
  });
});

describe("EstornarPagamentoUseCase (compensacao)", () => {
  async function comPagamentoAprovado(cenario: Cenario) {
    const orcamento = await gerarOrcamento(cenario);
    const pagamento = await cenario.container.registrarPagamento.execute({
      ...CTX,
      orcamentoId: orcamento.id.getValue(),
      clienteId: "cliente-1",
      valor: 581,
    });
    cenario.mensageria.limpar();
    return pagamento!;
  }

  it("estorna no provedor e confirma a compensacao", async () => {
    const cenario = montar();
    const pagamento = await comPagamentoAprovado(cenario);

    await cenario.container.estornarPagamento.execute({
      ...CTX,
      pagamentoId: pagamento.id.getValue(),
      motivo: "Execucao falhou",
    });

    const atualizado = await cenario.container.pagamentoRepository.obter(
      pagamento.id.getValue(),
    );
    expect(atualizado?.estaEstornado()).toBe(true);
    expect(cenario.provedor.estornos).toEqual([
      { idExterno: pagamento.idExterno, motivo: "Execucao falhou" },
    ]);
    expect(cenario.mensageria.tipos()).toEqual([
      TipoResposta.PAGAMENTO_ESTORNADO,
    ]);
  });

  it("localiza o pagamento pela Saga quando o id nao vem no comando", async () => {
    const cenario = montar();
    await comPagamentoAprovado(cenario);

    await cenario.container.estornarPagamento.execute({
      ...CTX,
      motivo: "rollback",
    });

    const atualizado = await cenario.container.pagamentoRepository.obterPorSaga(
      "saga-1",
    );
    expect(atualizado?.estaEstornado()).toBe(true);
  });

  it("responde sem erro quando nao existe pagamento a estornar", async () => {
    const cenario = montar();

    await cenario.container.estornarPagamento.execute({
      ...CTX,
      motivo: "nada a estornar",
    });

    expect(cenario.mensageria.tipos()).toEqual([
      TipoResposta.PAGAMENTO_ESTORNADO,
    ]);
  });

  it("e idempotente: estorno repetido apenas repete a resposta", async () => {
    const cenario = montar();
    const pagamento = await comPagamentoAprovado(cenario);

    await cenario.container.estornarPagamento.execute({
      ...CTX,
      pagamentoId: pagamento.id.getValue(),
      motivo: "rollback",
    });
    await cenario.container.estornarPagamento.execute({
      ...CTX,
      pagamentoId: pagamento.id.getValue(),
      motivo: "rollback",
    });

    // Apenas UM estorno chegou ao provedor: devolver em dobro seria um erro
    // com consequencia financeira.
    expect(cenario.provedor.estornos).toHaveLength(1);
    expect(cenario.mensageria.tipos()).toHaveLength(2);
  });

  // Abortar aqui deixaria a Saga presa em COMPENSANDO para sempre.
  it("conclui a compensacao mesmo se o provedor externo falhar", async () => {
    const cenario = montar();
    const pagamento = await comPagamentoAprovado(cenario);
    cenario.provedor.falharProximaChamada = true;

    await cenario.container.estornarPagamento.execute({
      ...CTX,
      pagamentoId: pagamento.id.getValue(),
      motivo: "rollback",
    });

    const atualizado = await cenario.container.pagamentoRepository.obter(
      pagamento.id.getValue(),
    );
    expect(atualizado?.estaEstornado()).toBe(true);
    expect(cenario.mensageria.tipos()).toEqual([
      TipoResposta.PAGAMENTO_ESTORNADO,
    ]);
  });
});

describe("Consultas do contexto de Billing", () => {
  it("apresenta o orcamento com itens e totais", async () => {
    const cenario = montar();
    const orcamento = await gerarOrcamento(cenario);

    const porId = await cenario.container.consultarOrcamento.porId(
      orcamento.id.getValue(),
    );
    expect(porId.itens).toHaveLength(2);
    expect(porId.itens[1].total).toBe(131);

    const porOs = await cenario.container.consultarOrcamento.porOrdemServico(
      "os-1",
    );
    expect(porOs.id).toBe(orcamento.id.getValue());

    const gerados = await cenario.container.consultarOrcamento.listar("gerado");
    expect(gerados).toHaveLength(1);
  });

  it("apresenta o pagamento aprovado", async () => {
    const cenario = montar();
    const orcamento = await gerarOrcamento(cenario);
    const pagamento = await cenario.container.registrarPagamento.execute({
      ...CTX,
      orcamentoId: orcamento.id.getValue(),
      clienteId: "cliente-1",
      valor: 581,
    });

    const porId = await cenario.container.consultarPagamento.porId(
      pagamento!.id.getValue(),
    );
    expect(porId.status).toBe(StatusPagamento.APROVADO);
    expect(porId.qrCode).toBeTruthy();

    const porOs = await cenario.container.consultarPagamento.porOrdemServico(
      "os-1",
    );
    expect(porOs.id).toBe(pagamento!.id.getValue());

    expect(
      await cenario.container.consultarPagamento.listar("APROVADO"),
    ).toHaveLength(1);
  });

  it("404 para agregados inexistentes", async () => {
    const cenario = montar();

    await expect(
      cenario.container.consultarOrcamento.porId("x"),
    ).rejects.toThrow("Orcamento nao encontrado.");
    await expect(
      cenario.container.consultarOrcamento.porOrdemServico("x"),
    ).rejects.toThrow("Nao existe orcamento");
    await expect(
      cenario.container.consultarPagamento.porId("x"),
    ).rejects.toThrow("Pagamento nao encontrado.");
    await expect(
      cenario.container.consultarPagamento.porOrdemServico("x"),
    ).rejects.toThrow("Nao existe pagamento");
  });
});
