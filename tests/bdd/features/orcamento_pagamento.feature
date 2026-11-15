# language: pt

Funcionalidade: Participacao do Billing na Saga da ordem de servico
  Como oficina mecanica
  Quero que orcamento e pagamento respondam a cada comando do orquestrador
  Para que nenhuma Saga fique pendurada e nenhum cliente seja cobrado em dobro

  Contexto:
    Dado um comando da Saga "saga-1" para a ordem de servico "os-1"

  @orcamento @caminho-feliz
  Cenario: Orcamento gerado a partir dos itens recebidos
    Quando o orquestrador envia o comando para gerar o orcamento com os itens:
      | item              | descricao          | quantidade | valorUnitario | tipo    |
      | srv-revisao       | Revisao completa   | 1          | 450.00        | SERVICO |
      | pec-filtro-oleo   | Filtro de oleo     | 2          | 65.50         | PECA    |
    Entao o Billing deve responder "ORCAMENTO_GERADO"
    E o valor total do orcamento deve ser 581.00
    E o orcamento deve estar com o status "GERADO"

  @orcamento @idempotencia
  Cenario: Comando reentregue nao gera um segundo orcamento
    Dado que o orcamento da Saga ja foi gerado no valor de 450.00
    Quando o orquestrador reenvia o mesmo comando de gerar orcamento
    Entao deve existir apenas 1 orcamento para a ordem de servico
    E o Billing deve responder "ORCAMENTO_GERADO"

  @pagamento @caminho-feliz
  Cenario: Cobranca aprovada pelo provedor de pagamentos
    Dado que o orcamento da Saga ja foi gerado no valor de 450.00
    Quando o orquestrador envia o comando para registrar o pagamento
    Entao o Billing deve responder "PAGAMENTO_REGISTRADO"
    E o pagamento deve estar com o status "APROVADO"
    E o orcamento deve estar com o status "APROVADO"
    E deve existir 1 cobranca registrada no provedor de pagamentos

  @pagamento @falha
  Cenario: Cobranca recusada pelo provedor dispara o rollback da Saga
    Dado que o orcamento da Saga ja foi gerado no valor de 450.00
    E que o provedor de pagamentos vai recusar a proxima cobranca
    Quando o orquestrador envia o comando para registrar o pagamento
    Entao o Billing deve responder "PAGAMENTO_FALHOU"
    E o pagamento deve estar com o status "RECUSADO"

  @compensacao @orcamento
  Cenario: Compensacao cancela o orcamento sem apagar o historico
    Dado que o orcamento da Saga ja foi gerado no valor de 450.00
    Quando o orquestrador envia a compensacao para cancelar o orcamento por "Pagamento recusado"
    Entao o Billing deve responder "ORCAMENTO_CANCELADO"
    E o orcamento deve estar com o status "CANCELADO"
    E o motivo registrado no orcamento deve ser "Pagamento recusado"

  @compensacao @pagamento @idempotencia
  Cenario: Estorno repetido nao devolve dinheiro duas vezes
    Dado que o orcamento da Saga ja foi gerado no valor de 450.00
    E que o pagamento da Saga ja foi aprovado
    Quando o orquestrador envia a compensacao para estornar o pagamento por "Execucao falhou"
    E o orquestrador reenvia a compensacao para estornar o pagamento por "Execucao falhou"
    Entao o pagamento deve estar com o status "ESTORNADO"
    E deve existir 1 estorno registrado no provedor de pagamentos

  @compensacao @resiliencia
  Cenario: Compensacao conclui mesmo com o provedor externo indisponivel
    Dado que o orcamento da Saga ja foi gerado no valor de 450.00
    E que o pagamento da Saga ja foi aprovado
    E que a proxima chamada ao provedor de pagamentos vai falhar
    Quando o orquestrador envia a compensacao para estornar o pagamento por "Execucao falhou"
    Entao o Billing deve responder "PAGAMENTO_ESTORNADO"
    E o pagamento deve estar com o status "ESTORNADO"

  @compensacao @tolerancia
  Cenario: Compensacao de algo que nunca existiu nao falha
    Quando o orquestrador envia a compensacao para cancelar o orcamento por "Falha antes do orcamento"
    Entao o Billing deve responder "ORCAMENTO_CANCELADO"
