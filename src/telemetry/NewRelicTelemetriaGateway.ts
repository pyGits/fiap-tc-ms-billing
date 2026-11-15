import TelemetriaGateway, {
  ResultadoComando,
} from "../../domain/gateway/TelemetriaGateway";
import { getContexto, getCorrelationId } from "../context";
import logger from "../logger";

type AgenteNewRelic = {
  recordCustomEvent: (nome: string, atributos: Record<string, unknown>) => void;
};

function carregarAgente(): AgenteNewRelic | null {
  if (!process.env.NEW_RELIC_LICENSE_KEY) return null;

  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    return require("newrelic") as AgenteNewRelic;
  } catch (erro) {
    logger.warn(
      { erro: erro instanceof Error ? erro.message : String(erro) },
      "agente New Relic indisponivel; telemetria apenas em log",
    );
    return null;
  }
}

// Observabilidade do participante da Saga.
//
// Os eventos levam sempre sagaId e correlationId: e assim que, no New Relic,
// um rollback aparece como uma sequencia unica atravessando os tres servicos,
// em vez de tres incidentes desconexos.
export default class NewRelicTelemetriaGateway implements TelemetriaGateway {
  private readonly agente: AgenteNewRelic | null;
  private readonly env: string;
  private readonly servico: string;

  constructor(agente: AgenteNewRelic | null = carregarAgente()) {
    this.agente = agente;
    this.env = process.env.APP_ENV || process.env.NODE_ENV || "local";
    this.servico = process.env.SERVICE_NAME || "fiap-tc-ms-billing";
  }

  registrarComando(dados: {
    sagaId: string;
    ordemServicoId: string;
    comando: string;
    resultado: ResultadoComando;
    duracaoMs: number;
    erro?: string;
  }): void {
    this.publicar("SagaComandoRecebido", {
      sagaId: dados.sagaId,
      ordemServicoId: dados.ordemServicoId,
      comando: dados.comando,
      resultado: dados.resultado,
      duracaoMs: dados.duracaoMs,
      erro: dados.erro ?? "",
    });
  }

  registrarPagamento(dados: {
    sagaId: string;
    ordemServicoId: string;
    pagamentoId: string;
    valor: number;
    meio: string;
    status: string;
  }): void {
    this.publicar("PagamentoRegistrado", { ...dados });
  }

  registrarEstorno(dados: {
    sagaId: string;
    ordemServicoId: string;
    pagamentoId: string;
    valor: number;
    motivo: string;
  }): void {
    // Estorno e sempre sinal de rollback: este evento alimenta um alerta,
    // porque uma Saga compensada significa que algum passo falhou.
    this.publicar("PagamentoEstornado", { ...dados });
  }

  registrarFalhaIntegracao(dados: {
    integracao: string;
    operacao: string;
    erro: string;
  }): void {
    this.publicar("IntegracaoFalha", { ...dados });
  }

  private publicar(evento: string, atributos: Record<string, unknown>) {
    const contexto = getContexto();

    const payload = {
      ...atributos,
      servico: this.servico,
      env: this.env,
      correlationId: getCorrelationId() ?? "",
      sagaIdContexto: contexto?.sagaId ?? "",
    };

    logger.info({ evento, ...payload }, "evento de telemetria");
    this.agente?.recordCustomEvent(evento, payload);
  }
}
