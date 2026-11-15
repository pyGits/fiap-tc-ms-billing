import assert from "assert";
import { Before, DataTable, Given, Then, When } from "@cucumber/cucumber";

import MensageriaGatewayMemoria from "../../../domain/gateway/Mock/MensageriaGatewayMemoria";
import PagamentoExternoGatewayMemoria from "../../../domain/gateway/Mock/PagamentoExternoGatewayMemoria";
import { criarContainer, Container } from "../../../src/container";

type Mundo = {
  container: Container;
  mensageria: MensageriaGatewayMemoria;
  provedor: PagamentoExternoGatewayMemoria;
  sagaId: string;
  ordemServicoId: string;
  orcamentoId?: string;
};

let mundo: Mundo;

const ITENS_PADRAO = [
  {
    id: "srv-revisao",
    descricao: "Revisao completa",
    quantidade: 1,
    valorUnitario: 450,
    tipo: "SERVICO",
  },
];

Before(() => {
  const container = criarContainer();
  mundo = {
    container,
    mensageria: container.mensageria as MensageriaGatewayMemoria,
    provedor: container.pagamentoExterno as PagamentoExternoGatewayMemoria,
    sagaId: "",
    ordemServicoId: "",
  };
});

function ctx() {
  return { sagaId: mundo.sagaId, ordemServicoId: mundo.ordemServicoId };
}

// ---------------------------------------------------------------------------
// Contexto
// ---------------------------------------------------------------------------

Given(
  "um comando da Saga {string} para a ordem de servico {string}",
  (sagaId: string, ordemServicoId: string) => {
    mundo.sagaId = sagaId;
    mundo.ordemServicoId = ordemServicoId;
  },
);

Given(
  "que o orcamento da Saga ja foi gerado no valor de {float}",
  async (valor: number) => {
    const orcamento = await mundo.container.gerarOrcamento.execute({
      ...ctx(),
      clienteId: "cliente-1",
      clienteEmail: "cliente@oficina.local",
      veiculoId: "veiculo-1",
      itens: [{ ...ITENS_PADRAO[0], valorUnitario: valor }],
    });

    assert.ok(orcamento, "O orcamento deveria ter sido gerado");
    mundo.orcamentoId = orcamento.id.getValue();
    mundo.mensageria.limpar();
  },
);

Given("que o pagamento da Saga ja foi aprovado", async () => {
  await mundo.container.registrarPagamento.execute({
    ...ctx(),
    orcamentoId: mundo.orcamentoId!,
    clienteId: "cliente-1",
    valor: 450,
  });

  const pagamento = await mundo.container.pagamentoRepository.obterPorSaga(
    mundo.sagaId,
  );
  assert.strictEqual(pagamento?.status, "APROVADO");
  mundo.mensageria.limpar();
});

Given("que o provedor de pagamentos vai recusar a proxima cobranca", () => {
  mundo.provedor.recusarProximaCobranca = true;
});

Given("que a proxima chamada ao provedor de pagamentos vai falhar", () => {
  mundo.provedor.falharProximaChamada = true;
});

// ---------------------------------------------------------------------------
// Comandos recebidos do orquestrador
// ---------------------------------------------------------------------------

When(
  "o orquestrador envia o comando para gerar o orcamento com os itens:",
  async (tabela: DataTable) => {
    const itens = tabela.hashes().map((linha) => ({
      id: linha.item,
      descricao: linha.descricao,
      quantidade: Number(linha.quantidade),
      valorUnitario: Number(linha.valorUnitario),
      tipo: linha.tipo,
    }));

    const orcamento = await mundo.container.gerarOrcamento.execute({
      ...ctx(),
      clienteId: "cliente-1",
      clienteEmail: "cliente@oficina.local",
      veiculoId: "veiculo-1",
      itens,
    });

    mundo.orcamentoId = orcamento?.id.getValue();
  },
);

When("o orquestrador reenvia o mesmo comando de gerar orcamento", async () => {
  await mundo.container.gerarOrcamento.execute({
    ...ctx(),
    clienteId: "cliente-1",
    veiculoId: "veiculo-1",
    itens: ITENS_PADRAO,
  });
});

When("o orquestrador envia o comando para registrar o pagamento", async () => {
  await mundo.container.registrarPagamento.execute({
    ...ctx(),
    orcamentoId: mundo.orcamentoId!,
    clienteId: "cliente-1",
    valor: 450,
  });
});

When(
  "o orquestrador envia a compensacao para cancelar o orcamento por {string}",
  async (motivo: string) => {
    await mundo.container.cancelarOrcamento.execute({
      ...ctx(),
      orcamentoId: mundo.orcamentoId,
      motivo,
    });
  },
);

When(
  "o orquestrador envia a compensacao para estornar o pagamento por {string}",
  async (motivo: string) => {
    await mundo.container.estornarPagamento.execute({ ...ctx(), motivo });
  },
);

When(
  "o orquestrador reenvia a compensacao para estornar o pagamento por {string}",
  async (motivo: string) => {
    await mundo.container.estornarPagamento.execute({ ...ctx(), motivo });
  },
);

// ---------------------------------------------------------------------------
// Verificacoes
// ---------------------------------------------------------------------------

Then("o Billing deve responder {string}", (tipo: string) => {
  assert.ok(
    mundo.mensageria.tipos().includes(tipo as never),
    `Resposta ${tipo} nao enviada. Enviadas: ${mundo.mensageria.tipos().join(", ")}`,
  );
});

Then("o valor total do orcamento deve ser {float}", async (valor: number) => {
  const orcamento = await mundo.container.orcamentoRepository.obterPorSaga(
    mundo.sagaId,
  );
  assert.strictEqual(orcamento?.valorTotal, valor);
});

Then("o orcamento deve estar com o status {string}", async (status: string) => {
  const orcamento = await mundo.container.orcamentoRepository.obterPorSaga(
    mundo.sagaId,
  );
  assert.strictEqual(orcamento?.status, status);
});

Then("o pagamento deve estar com o status {string}", async (status: string) => {
  const pagamento = await mundo.container.pagamentoRepository.obterPorSaga(
    mundo.sagaId,
  );
  assert.strictEqual(pagamento?.status, status);
});

Then(
  "o motivo registrado no orcamento deve ser {string}",
  async (motivo: string) => {
    const orcamento = await mundo.container.orcamentoRepository.obterPorSaga(
      mundo.sagaId,
    );
    assert.strictEqual(orcamento?.motivoCancelamento, motivo);
  },
);

Then(
  "deve existir apenas {int} orcamento para a ordem de servico",
  async (quantidade: number) => {
    const orcamentos = await mundo.container.orcamentoRepository.listar();
    assert.strictEqual(orcamentos.length, quantidade);
  },
);

Then(
  "deve existir {int} cobranca(s) registrada(s) no provedor de pagamentos",
  (quantidade: number) => {
    assert.strictEqual(mundo.provedor.cobrancas.size, quantidade);
  },
);

// Estornar duas vezes devolveria o dinheiro em dobro: a idempotencia aqui tem
// consequencia financeira direta.
Then(
  "deve existir {int} estorno(s) registrado(s) no provedor de pagamentos",
  (quantidade: number) => {
    assert.strictEqual(mundo.provedor.estornos.length, quantidade);
  },
);
