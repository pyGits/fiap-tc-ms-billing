import { randomUUID } from "crypto";
import PagamentoExternoGateway, {
  CobrancaExterna,
  DadosCobranca,
} from "../PagamentoExternoGateway";

// Dublê do provedor de pagamentos.
//
// Serve a dois propositos:
//   - testes unitarios e BDD sem chamar a API do Mercado Pago;
//   - ambiente local e de demonstracao (MERCADO_PAGO_MOCK=true), onde a Saga
//     precisa rodar ponta a ponta sem credenciais reais.
export default class PagamentoExternoGatewayMemoria
  implements PagamentoExternoGateway
{
  readonly cobrancas = new Map<string, CobrancaExterna>();
  readonly estornos: Array<{ idExterno: string; motivo: string }> = [];

  // Controles para os testes de falha.
  recusarProximaCobranca = false;
  falharProximaChamada = false;

  async criarCobranca(dados: DadosCobranca): Promise<CobrancaExterna> {
    if (this.falharProximaChamada) {
      this.falharProximaChamada = false;
      throw new Error("Falha simulada na comunicacao com o provedor.");
    }

    const idExterno = `mp-${randomUUID().slice(0, 8)}`;

    const cobranca: CobrancaExterna = this.recusarProximaCobranca
      ? {
          idExterno,
          status: "RECUSADO",
          motivo: "Cartao recusado pelo emissor (simulado).",
        }
      : {
          idExterno,
          status: "APROVADO",
          qrCode: `00020126580014BR.GOV.BCB.PIX-${dados.pagamentoId}`,
        };

    this.recusarProximaCobranca = false;
    this.cobrancas.set(idExterno, cobranca);
    return cobranca;
  }

  async estornar(idExterno: string, motivo: string): Promise<void> {
    if (this.falharProximaChamada) {
      this.falharProximaChamada = false;
      throw new Error("Falha simulada no estorno.");
    }

    this.estornos.push({ idExterno, motivo });

    const cobranca = this.cobrancas.get(idExterno);
    if (cobranca) {
      this.cobrancas.set(idExterno, { ...cobranca, status: "RECUSADO" });
    }
  }

  async consultar(idExterno: string): Promise<CobrancaExterna> {
    return (
      this.cobrancas.get(idExterno) ?? {
        idExterno,
        status: "PENDENTE",
      }
    );
  }

  limpar() {
    this.cobrancas.clear();
    this.estornos.length = 0;
    this.recusarProximaCobranca = false;
    this.falharProximaChamada = false;
  }
}
