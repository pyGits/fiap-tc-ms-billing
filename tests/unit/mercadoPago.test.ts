import MercadoPagoGateway from "../../domain/gateway/MercadoPago/MercadoPagoGateway";
import ErroDominio from "../../domain/ErroDominio";

type Chamada = {
  url: string;
  corpo?: unknown;
  config?: { headers?: Record<string, string> };
};

// Cliente HTTP simulado no lugar do axios: o teste controla a resposta do
// provedor sem tocar a rede.
function httpFake(
  respostas: Array<{ data?: unknown; erro?: Error }> = [],
) {
  const chamadas: Chamada[] = [];
  let indice = 0;

  const proxima = () => {
    const resposta = respostas[indice] ?? respostas[respostas.length - 1];
    indice += 1;
    if (resposta?.erro) throw resposta.erro;
    return { data: resposta?.data ?? {} };
  };

  return {
    chamadas,
    http: {
      post: async (url: string, corpo?: unknown, config?: Chamada["config"]) => {
        chamadas.push({ url, corpo, config });
        return proxima();
      },
      get: async (url: string) => {
        chamadas.push({ url });
        return proxima();
      },
    } as never,
  };
}

describe("MercadoPagoGateway - criacao de cobranca", () => {
  it("envia a cobranca Pix com a chave de idempotencia do pagamento", async () => {
    const { http, chamadas } = httpFake([
      {
        data: {
          id: 123456,
          status: "approved",
          point_of_interaction: {
            transaction_data: { qr_code: "00020126..." },
          },
        },
      },
    ]);

    const gateway = new MercadoPagoGateway(http);

    const resultado = await gateway.criarCobranca({
      pagamentoId: "pag-1",
      ordemServicoId: "os-1",
      descricao: "Ordem de servico os-1",
      valor: 581,
      emailCliente: "cliente@oficina.local",
    });

    expect(resultado).toEqual({
      idExterno: "123456",
      status: "APROVADO",
      qrCode: "00020126...",
      motivo: undefined,
    });

    expect(chamadas[0].url).toBe("/v1/payments");
    expect(chamadas[0].corpo).toMatchObject({
      transaction_amount: 581,
      external_reference: "os-1",
      payer: { email: "cliente@oficina.local" },
    });
    // Uma retentativa da MESMA cobranca reaproveita a operacao no provedor em
    // vez de criar uma segunda.
    expect(chamadas[0].config?.headers?.["X-Idempotency-Key"]).toBe("pag-1");
  });

  it("usa e-mail generico quando o cliente nao informou um", async () => {
    const { http, chamadas } = httpFake([{ data: { id: 1, status: "pending" } }]);
    const gateway = new MercadoPagoGateway(http);

    await gateway.criarCobranca({
      pagamentoId: "pag-1",
      ordemServicoId: "os-1",
      descricao: "x",
      valor: 10,
    });

    expect(chamadas[0].corpo).toMatchObject({
      payer: { email: "cliente@oficina.local" },
    });
  });

  // Anti-Corruption Layer: o vocabulario do provedor nao entra no dominio.
  it.each([
    ["approved", "APROVADO"],
    ["authorized", "APROVADO"],
    ["pending", "PENDENTE"],
    ["in_process", "PENDENTE"],
    ["rejected", "RECUSADO"],
    ["cancelled", "RECUSADO"],
    ["refunded", "RECUSADO"],
    ["charged_back", "RECUSADO"],
    ["status_desconhecido", "PENDENTE"],
  ])("traduz o status %s do provedor para %s", async (externo, interno) => {
    const { http } = httpFake([{ data: { id: 1, status: externo } }]);
    const gateway = new MercadoPagoGateway(http);

    const resultado = await gateway.criarCobranca({
      pagamentoId: "pag-1",
      ordemServicoId: "os-1",
      descricao: "x",
      valor: 10,
    });

    expect(resultado.status).toBe(interno);
  });

  it("traduz falha de comunicacao em erro de dominio 502", async () => {
    const { http } = httpFake([{ erro: new Error("ETIMEDOUT") }]);
    const gateway = new MercadoPagoGateway(http);

    try {
      await gateway.criarCobranca({
        pagamentoId: "pag-1",
        ordemServicoId: "os-1",
        descricao: "x",
        valor: 10,
      });
      fail("deveria ter lancado ErroDominio");
    } catch (erro) {
      expect(erro).toBeInstanceOf(ErroDominio);
      expect((erro as ErroDominio).status).toBe(502);
      // A mensagem tecnica do provedor nao vaza.
      expect((erro as ErroDominio).message).not.toContain("ETIMEDOUT");
    }
  });
});

describe("MercadoPagoGateway - estorno e consulta", () => {
  it("solicita o estorno com chave de idempotencia deterministica", async () => {
    const { http, chamadas } = httpFake([{ data: {} }]);
    const gateway = new MercadoPagoGateway(http);

    await gateway.estornar("mp-123", "Execucao falhou");

    expect(chamadas[0].url).toBe("/v1/payments/mp-123/refunds");
    // Repetir o estorno nao devolve dinheiro duas vezes.
    expect(chamadas[0].config?.headers?.["X-Idempotency-Key"]).toBe(
      "refund-mp-123",
    );
  });

  it("consulta o status de um pagamento", async () => {
    const { http, chamadas } = httpFake([
      { data: { id: "mp-123", status: "approved" } },
    ]);
    const gateway = new MercadoPagoGateway(http);

    const resultado = await gateway.consultar("mp-123");

    expect(chamadas[0].url).toBe("/v1/payments/mp-123");
    expect(resultado.status).toBe("APROVADO");
  });

  it("traduz falha no estorno e na consulta", async () => {
    const gatewayEstorno = new MercadoPagoGateway(
      httpFake([{ erro: new Error("500") }]).http,
    );
    await expect(gatewayEstorno.estornar("mp-1", "x")).rejects.toThrow(
      ErroDominio,
    );

    const gatewayConsulta = new MercadoPagoGateway(
      httpFake([{ erro: new Error("500") }]).http,
    );
    await expect(gatewayConsulta.consultar("mp-1")).rejects.toThrow(ErroDominio);
  });
});

describe("MercadoPagoGateway - Circuit Breaker", () => {
  const limiteOriginal = process.env.MERCADO_PAGO_LIMITE_FALHAS;

  afterEach(() => {
    if (limiteOriginal === undefined) {
      delete process.env.MERCADO_PAGO_LIMITE_FALHAS;
    } else {
      process.env.MERCADO_PAGO_LIMITE_FALHAS = limiteOriginal;
    }
  });

  // Sem o circuito, cada mensagem da fila ficaria presa esperando o timeout de
  // um provedor que ja se sabe indisponivel - e a fila inteira travaria.
  it("abre o circuito depois de N falhas consecutivas e responde de imediato", async () => {
    const { http, chamadas } = httpFake([{ erro: new Error("503") }]);
    const gateway = new MercadoPagoGateway(http);

    const cobranca = {
      pagamentoId: "pag-1",
      ordemServicoId: "os-1",
      descricao: "x",
      valor: 10,
    };

    // O limite padrao e 3 falhas.
    for (let tentativa = 0; tentativa < 3; tentativa += 1) {
      await expect(gateway.criarCobranca(cobranca)).rejects.toThrow(ErroDominio);
    }

    const chamadasAntes = chamadas.length;

    try {
      await gateway.criarCobranca(cobranca);
      fail("deveria ter lancado ErroDominio");
    } catch (erro) {
      expect((erro as ErroDominio).codigo).toBe("mercadopago.circuito.aberto");
      expect((erro as ErroDominio).status).toBe(503);
    }

    // Nenhuma chamada nova foi feita ao provedor.
    expect(chamadas.length).toBe(chamadasAntes);
  });

  it("zera o contador de falhas apos um sucesso", async () => {
    const { http } = httpFake([
      { erro: new Error("503") },
      { erro: new Error("503") },
      { data: { id: 1, status: "approved" } },
      { erro: new Error("503") },
    ]);
    const gateway = new MercadoPagoGateway(http);

    const cobranca = {
      pagamentoId: "pag-1",
      ordemServicoId: "os-1",
      descricao: "x",
      valor: 10,
    };

    await expect(gateway.criarCobranca(cobranca)).rejects.toThrow();
    await expect(gateway.criarCobranca(cobranca)).rejects.toThrow();
    await expect(gateway.criarCobranca(cobranca)).resolves.toMatchObject({
      status: "APROVADO",
    });

    // A terceira falha, depois do sucesso, ainda nao abre o circuito.
    try {
      await gateway.criarCobranca(cobranca);
      fail("deveria ter lancado ErroDominio");
    } catch (erro) {
      expect((erro as ErroDominio).codigo).toBe("mercadopago.indisponivel");
    }
  });
});
