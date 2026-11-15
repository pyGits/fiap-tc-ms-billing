export type CobrancaExterna = {
  idExterno: string;
  status: "APROVADO" | "RECUSADO" | "PENDENTE";
  qrCode?: string;
  motivo?: string;
};

export type DadosCobranca = {
  pagamentoId: string;
  ordemServicoId: string;
  descricao: string;
  valor: number;
  emailCliente?: string;
};

// Porta para o provedor de pagamentos (Mercado Pago).
//
// Isolar o provedor atras de uma interface permite: (1) testar o participante
// da Saga sem chamar a API externa; (2) trocar o provedor sem tocar no
// dominio; (3) aplicar Circuit Breaker na implementacao, nao na regra de
// negocio (Aula 2 de "Estrutura de Microsservicos").
export default interface PagamentoExternoGateway {
  criarCobranca(dados: DadosCobranca): Promise<CobrancaExterna>;
  // Estorno: a compensacao do passo de pagamento.
  estornar(idExterno: string, motivo: string): Promise<void>;
  consultar(idExterno: string): Promise<CobrancaExterna>;
}
