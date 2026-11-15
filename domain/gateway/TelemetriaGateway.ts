export type ResultadoComando = "CONCLUIDO" | "FALHOU" | "COMPENSADO";

// Observabilidade do participante da Saga.
//   SagaComandoRecebido - cada comando processado, com resultado e duracao
//   PagamentoRegistrado - valor e meio de pagamento aprovados
//   PagamentoEstornado  - compensacoes executadas (alerta operacional)
//   IntegracaoFalha     - falhas na chamada ao Mercado Pago
export default interface TelemetriaGateway {
  registrarComando(dados: {
    sagaId: string;
    ordemServicoId: string;
    comando: string;
    resultado: ResultadoComando;
    duracaoMs: number;
    erro?: string;
  }): void;

  registrarPagamento(dados: {
    sagaId: string;
    ordemServicoId: string;
    pagamentoId: string;
    valor: number;
    meio: string;
    status: string;
  }): void;

  registrarEstorno(dados: {
    sagaId: string;
    ordemServicoId: string;
    pagamentoId: string;
    valor: number;
    motivo: string;
  }): void;

  registrarFalhaIntegracao(dados: {
    integracao: string;
    operacao: string;
    erro: string;
  }): void;
}
