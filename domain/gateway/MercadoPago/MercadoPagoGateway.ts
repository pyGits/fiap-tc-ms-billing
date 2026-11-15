import axios, { AxiosInstance } from "axios";
import { randomUUID } from "crypto";
import ErroDominio from "../../ErroDominio";
import logger from "../../../src/logger";
import PagamentoExternoGateway, {
  CobrancaExterna,
  DadosCobranca,
} from "../PagamentoExternoGateway";

// Integracao com o Mercado Pago (API de Pagamentos).
//
// Dois cuidados de borda, da Aula 2 de "Estrutura de Microsservicos":
//
//   - X-Idempotency-Key: se a nossa chamada falhar por timeout e for repetida,
//     o Mercado Pago reconhece a mesma operacao e nao cria uma segunda
//     cobranca. Idempotencia nao e so nossa responsabilidade interna;
//   - Circuit Breaker simplificado: depois de N falhas consecutivas o gateway
//     para de tentar por um intervalo e responde de imediato. Sem isso, cada
//     mensagem da fila ficaria presa esperando o timeout de um provedor que
//     ja sabemos estar fora - e a fila inteira travaria.
const BASE_URL = process.env.MERCADO_PAGO_BASE_URL || "https://api.mercadopago.com";
const ACCESS_TOKEN = process.env.MERCADO_PAGO_ACCESS_TOKEN || "";
const LIMITE_FALHAS = Number(process.env.MERCADO_PAGO_LIMITE_FALHAS || 3);
const JANELA_ABERTA_MS = Number(process.env.MERCADO_PAGO_JANELA_MS || 30000);

type RespostaPagamentoMP = {
  id: number | string;
  status: string;
  status_detail?: string;
  point_of_interaction?: {
    transaction_data?: { qr_code?: string };
  };
};

export default class MercadoPagoGateway implements PagamentoExternoGateway {
  private falhasConsecutivas = 0;
  private abertoAte = 0;

  constructor(
    private readonly http: AxiosInstance = axios.create({
      baseURL: BASE_URL,
      timeout: Number(process.env.MERCADO_PAGO_TIMEOUT_MS || 8000),
      headers: {
        Authorization: `Bearer ${ACCESS_TOKEN}`,
        "Content-Type": "application/json",
      },
    }),
  ) {}

  private verificarCircuito() {
    if (this.abertoAte > Date.now()) {
      throw new ErroDominio(
        "mercadopago.circuito.aberto",
        "Provedor de pagamentos temporariamente indisponivel.",
        503,
      );
    }
  }

  private registrarSucesso() {
    this.falhasConsecutivas = 0;
    this.abertoAte = 0;
  }

  private registrarFalha() {
    this.falhasConsecutivas += 1;
    if (this.falhasConsecutivas >= LIMITE_FALHAS) {
      this.abertoAte = Date.now() + JANELA_ABERTA_MS;
      logger.error(
        { falhas: this.falhasConsecutivas, janelaMs: JANELA_ABERTA_MS },
        "circuito do Mercado Pago aberto",
      );
    }
  }

  async criarCobranca(dados: DadosCobranca): Promise<CobrancaExterna> {
    this.verificarCircuito();

    try {
      const resposta = await this.http.post<RespostaPagamentoMP>(
        "/v1/payments",
        {
          transaction_amount: dados.valor,
          description: dados.descricao,
          payment_method_id: "pix",
          external_reference: dados.ordemServicoId,
          payer: {
            email: dados.emailCliente || "cliente@oficina.local",
          },
        },
        {
          headers: {
            // A chave de idempotencia e deterministica por pagamento: uma
            // retentativa da MESMA cobranca reaproveita a operacao original.
            "X-Idempotency-Key": dados.pagamentoId || randomUUID(),
          },
        },
      );

      this.registrarSucesso();
      return this.traduzir(resposta.data);
    } catch (erro) {
      this.registrarFalha();
      throw this.traduzirErro(erro, "criarCobranca");
    }
  }

  async estornar(idExterno: string, motivo: string): Promise<void> {
    this.verificarCircuito();

    try {
      await this.http.post(
        `/v1/payments/${idExterno}/refunds`,
        {},
        { headers: { "X-Idempotency-Key": `refund-${idExterno}` } },
      );
      this.registrarSucesso();

      logger.info({ idExterno, motivo }, "estorno solicitado ao Mercado Pago");
    } catch (erro) {
      this.registrarFalha();
      throw this.traduzirErro(erro, "estornar");
    }
  }

  async consultar(idExterno: string): Promise<CobrancaExterna> {
    this.verificarCircuito();

    try {
      const resposta = await this.http.get<RespostaPagamentoMP>(
        `/v1/payments/${idExterno}`,
      );
      this.registrarSucesso();
      return this.traduzir(resposta.data);
    } catch (erro) {
      this.registrarFalha();
      throw this.traduzirErro(erro, "consultar");
    }
  }

  // Traducao do vocabulario do provedor para o nosso.
  //
  // E uma Anti-Corruption Layer em miniatura (DDD): os status do Mercado Pago
  // nao vazam para dentro do dominio.
  private traduzir(resposta: RespostaPagamentoMP): CobrancaExterna {
    const status = String(resposta.status || "").toLowerCase();

    const mapa: Record<string, CobrancaExterna["status"]> = {
      approved: "APROVADO",
      authorized: "APROVADO",
      pending: "PENDENTE",
      in_process: "PENDENTE",
      in_mediation: "PENDENTE",
      rejected: "RECUSADO",
      cancelled: "RECUSADO",
      refunded: "RECUSADO",
      charged_back: "RECUSADO",
    };

    return {
      idExterno: String(resposta.id),
      status: mapa[status] ?? "PENDENTE",
      qrCode: resposta.point_of_interaction?.transaction_data?.qr_code,
      motivo: resposta.status_detail,
    };
  }

  private traduzirErro(erro: unknown, operacao: string): ErroDominio {
    const detalhe =
      axios.isAxiosError(erro) && erro.response
        ? `HTTP ${erro.response.status}`
        : erro instanceof Error
          ? erro.message
          : String(erro);

    logger.error({ operacao, detalhe }, "falha na integracao com o Mercado Pago");

    return new ErroDominio(
      "mercadopago.indisponivel",
      `Falha ao comunicar com o provedor de pagamentos (${operacao}).`,
      502,
    );
  }
}
