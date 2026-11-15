import request from "supertest";

import ColecaoFake from "../apoio/ColecaoFake";
import Orcamento, { StatusOrcamento } from "../../domain/entity/Orcamento";
import ItemOrcamento, { TipoItem } from "../../domain/entity/ItemOrcamento";
import Pagamento, { StatusPagamento } from "../../domain/entity/Pagamento";
import OrcamentoRepositoryMongo, {
  DocumentoOrcamento,
} from "../../domain/repository/Mongo/OrcamentoRepositoryMongo";
import PagamentoRepositoryMongo, {
  DocumentoPagamento,
} from "../../domain/repository/Mongo/PagamentoRepositoryMongo";
import MensagemProcessadaRepositoryMongo, {
  DocumentoMensagem,
} from "../../domain/repository/Mongo/MensagemProcessadaRepositoryMongo";
import ComandoConsumer from "../../src/messaging/ComandoConsumer";
import RabbitMQMensageriaGateway from "../../src/messaging/RabbitMQMensageriaGateway";
import MessagePublisher from "../../src/messaging/MessagePublisher";
import NewRelicTelemetriaGateway from "../../src/telemetry/NewRelicTelemetriaGateway";
import criarApp from "../../src/app";
import { criarContainer } from "../../src/container";
import {
  Mensagem,
  ROUTING_KEYS,
  TipoComando,
  TipoResposta,
} from "../../src/messaging/contracts";
import MensagemProcessadaRepositoryMemoria from "../../domain/repository/Mock/MensagemProcessadaRepositoryMemoria";

const CTX = { sagaId: "saga-1", ordemServicoId: "os-1" };

function itens() {
  return [
    new ItemOrcamento({
      referenciaId: "srv-revisao",
      descricao: "Revisao completa",
      tipo: TipoItem.SERVICO,
      quantidade: 1,
      valorUnitario: 450,
    }),
  ];
}

function novoOrcamento(sagaId = "saga-1", ordemServicoId = "os-1") {
  return new Orcamento({
    ordemServicoId,
    clienteId: "cliente-1",
    clienteEmail: "cliente@oficina.local",
    veiculoId: "veiculo-1",
    sagaId,
    itens: itens(),
  });
}

describe("OrcamentoRepositoryMongo", () => {
  it("serializa o agregado com os itens embutidos e reidrata sem perda", async () => {
    const colecao = new ColecaoFake<DocumentoOrcamento>();
    const repositorio = new OrcamentoRepositoryMongo(colecao.comoColecao());
    const orcamento = novoOrcamento();

    await repositorio.salvar(orcamento);

    const documento = colecao.documentos.get(orcamento.id.getValue());
    // O _id e o UUID do dominio: o mesmo identificador viaja nas mensagens
    // da Saga e precisa valer nos tres servicos.
    expect(documento?._id).toBe(orcamento.id.getValue());
    expect(documento?.itens).toHaveLength(1);

    const recuperado = await repositorio.obter(orcamento.id.getValue());
    expect(recuperado?.valorTotal).toBe(450);
    expect(recuperado?.itens[0].descricao).toBe("Revisao completa");
    expect(recuperado?.clienteEmail).toBe("cliente@oficina.local");
  });

  it("atualiza por upsert e consulta por ordem de servico, Saga e status", async () => {
    const colecao = new ColecaoFake<DocumentoOrcamento>();
    const repositorio = new OrcamentoRepositoryMongo(colecao.comoColecao());
    const orcamento = novoOrcamento();
    await repositorio.salvar(orcamento);

    orcamento.cancelar("rollback");
    await repositorio.atualizar(orcamento);

    expect(colecao.documentos.size).toBe(1);
    expect((await repositorio.obterPorOrdemServico("os-1"))?.estaCancelado()).toBe(
      true,
    );
    expect((await repositorio.obterPorSaga("saga-1"))?.status).toBe(
      StatusOrcamento.CANCELADO,
    );
    expect(await repositorio.listar(StatusOrcamento.CANCELADO)).toHaveLength(1);
    expect(await repositorio.listar(StatusOrcamento.GERADO)).toHaveLength(0);
    expect(await repositorio.listar()).toHaveLength(1);
  });

  it("devolve nulo quando nao encontra", async () => {
    const colecao = new ColecaoFake<DocumentoOrcamento>();
    const repositorio = new OrcamentoRepositoryMongo(colecao.comoColecao());

    expect(await repositorio.obter("x")).toBeNull();
    expect(await repositorio.obterPorOrdemServico("x")).toBeNull();
    expect(await repositorio.obterPorSaga("x")).toBeNull();
  });
});

describe("PagamentoRepositoryMongo", () => {
  function novoPagamento() {
    return new Pagamento({
      orcamentoId: "orc-1",
      ordemServicoId: "os-1",
      clienteId: "cliente-1",
      sagaId: "saga-1",
      valor: 450,
    });
  }

  it("persiste, atualiza e consulta por todas as chaves de negocio", async () => {
    const colecao = new ColecaoFake<DocumentoPagamento>();
    const repositorio = new PagamentoRepositoryMongo(colecao.comoColecao());
    const pagamento = novoPagamento();

    await repositorio.salvar(pagamento);
    pagamento.aprovar("mp-123", "qr");
    await repositorio.atualizar(pagamento);

    expect((await repositorio.obter(pagamento.id.getValue()))?.idExterno).toBe(
      "mp-123",
    );
    expect((await repositorio.obterPorOrcamento("orc-1"))?.estaAprovado()).toBe(
      true,
    );
    expect((await repositorio.obterPorOrdemServico("os-1"))?.qrCode).toBe("qr");
    expect((await repositorio.obterPorSaga("saga-1"))?.valor).toBe(450);
    expect(await repositorio.listar(StatusPagamento.APROVADO)).toHaveLength(1);
    expect(await repositorio.listar()).toHaveLength(1);
  });

  it("devolve nulo quando nao encontra", async () => {
    const colecao = new ColecaoFake<DocumentoPagamento>();
    const repositorio = new PagamentoRepositoryMongo(colecao.comoColecao());

    expect(await repositorio.obter("x")).toBeNull();
    expect(await repositorio.obterPorOrcamento("x")).toBeNull();
    expect(await repositorio.obterPorOrdemServico("x")).toBeNull();
    expect(await repositorio.obterPorSaga("x")).toBeNull();
  });
});

describe("MensagemProcessadaRepositoryMongo", () => {
  it("registra a mensagem e reconhece a reentrega", async () => {
    const colecao = new ColecaoFake<DocumentoMensagem>();
    const repositorio = new MensagemProcessadaRepositoryMongo(
      colecao.comoColecao(),
    );

    expect(await repositorio.jaProcessada("msg-1")).toBe(false);

    await repositorio.registrar({
      mensagemId: "msg-1",
      tipo: TipoComando.GERAR_ORCAMENTO,
      sagaId: "saga-1",
    });

    expect(await repositorio.jaProcessada("msg-1")).toBe(true);
  });

  // O indice unico e a barreira contra duas replicas processando a mesma
  // reentrega ao mesmo tempo: a perdedora recebe erro 11000 e para.
  it("absorve o erro de chave duplicada", async () => {
    const colecao = new ColecaoFake<DocumentoMensagem>();
    const repositorio = new MensagemProcessadaRepositoryMongo(
      colecao.comoColecao(),
    );

    await repositorio.registrar({ mensagemId: "msg-1", tipo: "X" });

    await expect(
      repositorio.registrar({ mensagemId: "msg-1", tipo: "X" }),
    ).resolves.toBeUndefined();
  });

  it("propaga erros que nao sao de duplicidade", async () => {
    const colecao = new ColecaoFake<DocumentoMensagem>();
    jest
      .spyOn(colecao, "insertOne")
      .mockRejectedValueOnce(new Error("banco indisponivel"));

    const repositorio = new MensagemProcessadaRepositoryMongo(
      colecao.comoColecao(),
    );

    await expect(
      repositorio.registrar({ mensagemId: "msg-2", tipo: "X" }),
    ).rejects.toThrow("banco indisponivel");
  });
});

describe("ComandoConsumer", () => {
  function mensagem(
    tipo: TipoComando,
    body: Record<string, unknown>,
    mensagemId = "msg-1",
  ): Mensagem {
    return {
      header: {
        mensagemId,
        sagaId: "saga-1",
        correlationId: "corr-1",
        ordemServicoId: "os-1",
        tipo,
        origem: "fiap-tc-ms-os",
        dataEnvio: new Date().toISOString(),
        tentativa: 1,
      },
      body,
    };
  }

  function montar() {
    const container = criarContainer();
    const mensagensProcessadas = new MensagemProcessadaRepositoryMemoria();
    const consumer = new ComandoConsumer(
      {
        gerarOrcamento: container.gerarOrcamento,
        cancelarOrcamento: container.cancelarOrcamento,
        registrarPagamento: container.registrarPagamento,
        estornarPagamento: container.estornarPagamento,
      },
      mensagensProcessadas,
    );

    return { container, consumer, mensagensProcessadas };
  }

  it("mapeia os quatro comandos do participante", () => {
    const { consumer } = montar();

    expect(Object.keys(consumer.manipuladores()).sort()).toEqual(
      [
        TipoComando.CANCELAR_ORCAMENTO,
        TipoComando.ESTORNAR_PAGAMENTO,
        TipoComando.GERAR_ORCAMENTO,
        TipoComando.REGISTRAR_PAGAMENTO,
      ].sort(),
    );
  });

  it("executa o comando e registra a mensagem como processada", async () => {
    const { consumer, container, mensagensProcessadas } = montar();

    await consumer.manipuladores()[TipoComando.GERAR_ORCAMENTO](
      mensagem(TipoComando.GERAR_ORCAMENTO, {
        clienteId: "cliente-1",
        veiculoId: "veiculo-1",
        itens: [
          {
            id: "srv-revisao",
            descricao: "Revisao",
            quantidade: 1,
            valorUnitario: 450,
            tipo: "SERVICO",
          },
        ],
      }),
    );

    expect(await container.orcamentoRepository.obterPorSaga("saga-1")).not.toBeNull();
    expect(await mensagensProcessadas.jaProcessada("msg-1")).toBe(true);
  });

  it("ignora a reentrega da mesma mensagem (idempotencia duravel)", async () => {
    const { consumer, container } = montar();
    const comando = mensagem(TipoComando.GERAR_ORCAMENTO, {
      clienteId: "cliente-1",
      veiculoId: "veiculo-1",
      itens: [
        {
          id: "srv-revisao",
          descricao: "Revisao",
          quantidade: 1,
          valorUnitario: 450,
          tipo: "SERVICO",
        },
      ],
    });

    await consumer.manipuladores()[TipoComando.GERAR_ORCAMENTO](comando);
    await consumer.manipuladores()[TipoComando.GERAR_ORCAMENTO](comando);

    expect(await container.orcamentoRepository.listar()).toHaveLength(1);
  });

  it("encaminha a compensacao de pagamento", async () => {
    const { consumer } = montar();

    await expect(
      consumer.manipuladores()[TipoComando.ESTORNAR_PAGAMENTO](
        mensagem(
          TipoComando.ESTORNAR_PAGAMENTO,
          { motivo: "rollback" },
          "msg-estorno",
        ),
      ),
    ).resolves.toBeUndefined();
  });

  it("encaminha a compensacao de orcamento", async () => {
    const { consumer } = montar();

    await expect(
      consumer.manipuladores()[TipoComando.CANCELAR_ORCAMENTO](
        mensagem(
          TipoComando.CANCELAR_ORCAMENTO,
          { motivo: "rollback" },
          "msg-cancelar",
        ),
      ),
    ).resolves.toBeUndefined();
  });

  it("encaminha o comando de pagamento", async () => {
    const { consumer } = montar();

    await expect(
      consumer.manipuladores()[TipoComando.REGISTRAR_PAGAMENTO](
        mensagem(
          TipoComando.REGISTRAR_PAGAMENTO,
          { orcamentoId: "orc-x", clienteId: "c", valor: 10 },
          "msg-pagar",
        ),
      ),
    ).resolves.toBeUndefined();
  });
});

describe("RabbitMQMensageriaGateway", () => {
  it("responde sempre na fila de reply do orquestrador", async () => {
    const publicadas: Array<{ exchange: string; routingKey: string }> = [];
    const canal = {
      publish: (exchange: string, routingKey: string) => {
        publicadas.push({ exchange, routingKey });
        return true;
      },
    };
    const conexao = { getChannel: async () => canal } as never;

    const gateway = new RabbitMQMensageriaGateway(
      new MessagePublisher(conexao, "billing"),
    );

    await gateway.responder(CTX, TipoResposta.ORCAMENTO_GERADO, {
      orcamentoId: "orc-1",
    });

    expect(publicadas[0].routingKey).toBe(ROUTING_KEYS.SAGA_REPLY);
  });
});

describe("NewRelicTelemetriaGateway", () => {
  it("publica os eventos de negocio do participante", () => {
    const eventos: string[] = [];
    const telemetria = new NewRelicTelemetriaGateway({
      recordCustomEvent: (nome) => eventos.push(nome),
    });

    telemetria.registrarComando({
      ...CTX,
      comando: "GERAR_ORCAMENTO",
      resultado: "CONCLUIDO",
      duracaoMs: 12,
    });
    telemetria.registrarPagamento({
      ...CTX,
      pagamentoId: "pag-1",
      valor: 450,
      meio: "PIX",
      status: "APROVADO",
    });
    telemetria.registrarEstorno({
      ...CTX,
      pagamentoId: "pag-1",
      valor: 450,
      motivo: "rollback",
    });
    telemetria.registrarFalhaIntegracao({
      integracao: "mercado-pago",
      operacao: "criarCobranca",
      erro: "timeout",
    });

    expect(eventos).toEqual([
      "SagaComandoRecebido",
      "PagamentoRegistrado",
      "PagamentoEstornado",
      "IntegracaoFalha",
    ]);
  });

  it("funciona sem o agente carregado", () => {
    const telemetria = new NewRelicTelemetriaGateway(null);

    expect(() =>
      telemetria.registrarComando({
        ...CTX,
        comando: "X",
        resultado: "FALHOU",
        duracaoMs: 1,
        erro: "erro",
      }),
    ).not.toThrow();
  });
});

describe("API do Billing", () => {
  function montarApp() {
    const container = criarContainer();
    return { app: criarApp(container), container };
  }

  async function comOrcamento(container: ReturnType<typeof criarContainer>) {
    return container.gerarOrcamento.execute({
      ...CTX,
      clienteId: "cliente-1",
      veiculoId: "veiculo-1",
      itens: [
        {
          id: "srv-revisao",
          descricao: "Revisao completa",
          quantidade: 1,
          valorUnitario: 450,
          tipo: "SERVICO",
        },
      ],
    });
  }

  it("GET /health e GET / identificam o servico", async () => {
    const { app } = montarApp();

    const saude = await request(app).get("/health").expect(200);
    expect(saude.body.servico).toBe("fiap-tc-ms-billing");

    const raiz = await request(app).get("/").expect(200);
    expect(raiz.body.papel).toContain("participante");
  });

  it("expoe o contrato OpenAPI com as rotas de consulta", async () => {
    const { app } = montarApp();

    const resposta = await request(app).get("/api-docs.json").expect(200);
    expect(Object.keys(resposta.body.paths)).toEqual(
      expect.arrayContaining(["/orcamentos", "/pagamentos"]),
    );
  });

  it("consulta orcamento por id e por ordem de servico", async () => {
    const { app, container } = montarApp();
    const orcamento = await comOrcamento(container);

    await request(app).get(`/orcamentos/${orcamento!.id.getValue()}`).expect(200);
    await request(app).get("/orcamentos/ordem-servico/os-1").expect(200);
    await request(app).get("/orcamentos?status=GERADO").expect(200);
  });

  it("consulta pagamento por id e por ordem de servico", async () => {
    const { app, container } = montarApp();
    const orcamento = await comOrcamento(container);
    const pagamento = await container.registrarPagamento.execute({
      ...CTX,
      orcamentoId: orcamento!.id.getValue(),
      clienteId: "cliente-1",
      valor: 450,
    });

    await request(app).get(`/pagamentos/${pagamento!.id.getValue()}`).expect(200);
    await request(app).get("/pagamentos/ordem-servico/os-1").expect(200);
    await request(app).get("/pagamentos?status=APROVADO").expect(200);
  });

  it("404 padronizado para agregado inexistente e rota desconhecida", async () => {
    const { app } = montarApp();

    const semOrcamento = await request(app).get("/orcamentos/x").expect(404);
    expect(semOrcamento.body.erro.codigo).toBe("orcamento.nao.encontrado");

    const semPagamento = await request(app)
      .get("/pagamentos/ordem-servico/x")
      .expect(404);
    expect(semPagamento.body.erro.codigo).toBe("pagamento.nao.encontrado");

    const semRota = await request(app).get("/inexistente").expect(404);
    expect(semRota.body.erro.codigo).toBe("rota.nao.encontrada");
  });

  describe("webhook do Mercado Pago", () => {
    it("aceita a notificacao e consulta o status no provedor", async () => {
      const { app } = montarApp();

      const resposta = await request(app)
        .post("/webhooks/mercado-pago")
        .send({ type: "payment", data: { id: "mp-123" } })
        .expect(200);

      expect(resposta.body).toMatchObject({ recebido: true, idExterno: "mp-123" });
    });

    it("ignora notificacao sem identificador", async () => {
      const { app } = montarApp();

      const resposta = await request(app)
        .post("/webhooks/mercado-pago")
        .send({ type: "test" })
        .expect(200);

      expect(resposta.body.ignorado).toBe(true);
    });

    it("rejeita notificacao com segredo invalido", async () => {
      process.env.MERCADO_PAGO_WEBHOOK_SECRET = "segredo-correto";
      const { app } = montarApp();

      const resposta = await request(app)
        .post("/webhooks/mercado-pago")
        .set("x-webhook-secret", "segredo-errado")
        .send({ data: { id: "mp-123" } })
        .expect(401);

      expect(resposta.body.erro.codigo).toBe("webhook.nao.autorizado");
      delete process.env.MERCADO_PAGO_WEBHOOK_SECRET;
    });

    it("aceita notificacao com o segredo correto", async () => {
      process.env.MERCADO_PAGO_WEBHOOK_SECRET = "segredo-correto";
      const { app } = montarApp();

      await request(app)
        .post("/webhooks/mercado-pago")
        .set("x-webhook-secret", "segredo-correto")
        .send({ data: { id: "mp-123" } })
        .expect(200);

      delete process.env.MERCADO_PAGO_WEBHOOK_SECRET;
    });
  });
});
