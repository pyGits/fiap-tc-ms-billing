import TelemetriaGateway, { ResultadoComando } from "../TelemetriaGateway";

export default class TelemetriaGatewayMemoria implements TelemetriaGateway {
  readonly comandos: Array<{ comando: string; resultado: ResultadoComando }> = [];
  readonly pagamentos: string[] = [];
  readonly estornos: string[] = [];
  readonly falhasIntegracao: string[] = [];

  registrarComando(dados: {
    comando: string;
    resultado: ResultadoComando;
  }): void {
    this.comandos.push({ comando: dados.comando, resultado: dados.resultado });
  }

  registrarPagamento(dados: { pagamentoId: string }): void {
    this.pagamentos.push(dados.pagamentoId);
  }

  registrarEstorno(dados: { pagamentoId: string }): void {
    this.estornos.push(dados.pagamentoId);
  }

  registrarFalhaIntegracao(dados: { integracao: string }): void {
    this.falhasIntegracao.push(dados.integracao);
  }

  limpar() {
    this.comandos.length = 0;
    this.pagamentos.length = 0;
    this.estornos.length = 0;
    this.falhasIntegracao.length = 0;
  }
}
