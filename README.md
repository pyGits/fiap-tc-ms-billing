# fiap-tc-ms-billing — Orçamento e Pagamento

Microsserviço **participante da Saga** da oficina mecânica. Responde por dois
passos do fluxo e pelas duas compensações correspondentes:

| Passo da Saga | Comando recebido | Compensação |
| --- | --- | --- |
| 2 — gerar orçamento | `GERAR_ORCAMENTO` | `CANCELAR_ORCAMENTO` |
| 4 — registrar pagamento | `REGISTRAR_PAGAMENTO` | `ESTORNAR_PAGAMENTO` |

Integra o **Mercado Pago** como provedor de cobrança. Faz parte do Tech
Challenge da **Fase 4** da Pós-Tech SOAT (FIAP):

| Serviço | Repositório | Papel na Saga | Banco | Porta local |
| --- | --- | --- | --- | --- |
| Ordem de Serviço | [fiap-tc-ms-os](https://github.com/pyGits/fiap-tc-ms-os) | Orquestrador | MySQL (SQL) | 3000 |
| **Orçamento e Pagamento** | [fiap-tc-ms-billing](https://github.com/pyGits/fiap-tc-ms-billing) | **Participante** | MongoDB (NoSQL) | 3001 |
| Execução e Produção | [fiap-tc-ms-execucao](https://github.com/pyGits/fiap-tc-ms-execucao) | Participante | MongoDB (NoSQL) | 3002 |

A estratégia da Saga e a justificativa da orquestração estão documentadas no
[README do OS Service](https://github.com/pyGits/fiap-tc-ms-os#a-saga).

---

## O que este serviço faz — e o que deliberadamente não faz

**Orçamentos e pagamentos não são criados por HTTP.** Eles nascem dos comandos
que o orquestrador publica na fila `saga.billing.comandos`. As rotas REST deste
serviço são de **consulta**.

Isso não é limitação: é a fronteira do serviço. Quem decide que uma OS merece
um orçamento é a Saga, que conhece o fluxo inteiro — não um cliente externo com
um `POST`. Permitir a criação por HTTP abriria caminho para orçamentos órfãos,
sem Saga que os acompanhe nem compensação que os desfaça.

A única rota que altera estado é o **webhook** do Mercado Pago — e mesmo ela não
confia no corpo recebido (ver abaixo).

---

## Integração com o Mercado Pago

O provedor é tratado como o que ele é: um sistema externo, instável e com
vocabulário próprio.

**Anti-Corruption Layer.** O status do provedor é traduzido para o vocabulário
do domínio na borda, e nada do dicionário dele entra no núcleo:

| Mercado Pago | Domínio |
| --- | --- |
| `approved`, `authorized` | `APROVADO` |
| `pending`, `in_process` | `PENDENTE` |
| `rejected`, `cancelled`, `refunded`, `charged_back` | `RECUSADO` |
| qualquer status desconhecido | `PENDENTE` (nunca aprova pelo que não entende) |

**Idempotência na cobrança.** Cada chamada envia o header
`X-Idempotency-Key` com o id do pagamento; o estorno usa `refund-<id>`. Uma
retentativa da **mesma** cobrança reaproveita a operação no provedor em vez de
criar uma segunda — aqui a idempotência tem consequência financeira direta.

**Circuit breaker.** Após 3 falhas consecutivas
(`MERCADO_PAGO_LIMITE_FALHAS`), o circuito abre e as chamadas seguintes falham
de imediato. Sem isso, cada mensagem da fila ficaria presa esperando o timeout
de um provedor que já se sabe indisponível — e a fila inteira travaria.

**Webhook que não confia no payload.** `POST /webhooks/mercado-pago` recebe a
notificação, **consulta o status na API do provedor** e só então altera estado.
Quando `MERCADO_PAGO_WEBHOOK_SECRET` está configurado, o segredo é exigido no
header; sem ele a notificação é rejeitada.

**Modo mock.** Com `MERCADO_PAGO_MOCK=true` (ou sem `MERCADO_PAGO_ACCESS_TOKEN`)
o serviço usa um provedor em memória e **não contata o Mercado Pago**. É o
padrão em ambiente local e em homologação: cobrar de verdade a cada execução do
pipeline não é aceitável.

**Estorno resiliente.** Se o provedor estiver fora no momento da compensação, o
pagamento é marcado como `ESTORNADO` no domínio e a falha de integração é
registrada na telemetria. A Saga **não pode** ficar presa em `COMPENSANDO`
esperando um serviço externo; a reconciliação é tratada como pendência
operacional, com evento próprio.

---

## Por que MongoDB aqui e MySQL no OS Service

O requisito da fase pede um banco SQL e um NoSQL, mas a escolha tem motivo de
modelagem:

Orçamento e pagamento são **agregados fechados**. O orçamento já chega com os
itens embutidos e é sempre lido por inteiro, nunca por junção com outras
coleções. Em um modelo relacional isso exigiria duas tabelas e um *join* a cada
leitura; como documento, é um único registro — leitura e escrita atômicas em um
só lugar.

A Ordem de Serviço, no outro extremo, tem relacionamentos fortes (cliente,
veículo, itens, histórico de status) e consultas agregadas por status, onde o
SQL é mais natural. Modela-se pela forma de acesso, não pela normalização.

Os índices são criados **em código** no bootstrap (`src/mongo.ts`), do mesmo
jeito que as migrations fazem no OS Service: local, homologação e produção sobem
idênticos. O índice **único** em `mensagens_processadas.mensagemId` é o que
torna a idempotência à prova de corrida entre duas réplicas do pod — e tem TTL
de 7 dias, porque controle de duplicidade não precisa ser eterno.

---

## Arquitetura

**Clean Architecture**: a regra de negócio não conhece Express, MongoDB,
RabbitMQ nem Mercado Pago.

```
domain/
  entity/            Orcamento, ItemOrcamento, Pagamento
  repository/        Portas + adaptadores Mongo e Memória
  gateway/           Portas de mensageria, telemetria e pagamento externo
    MercadoPago/     Adaptador do provedor (ACL + idempotência + circuit breaker)
    Mock/            Dublês usados em teste e no ambiente local
  usecase/           Gerar/Cancelar orçamento, Registrar/Estornar/Consultar pagamento
src/
  routes/            Adaptador de entrada síncrono (consultas + webhook)
  messaging/         Adaptador de entrada assíncrono (ComandoConsumer)
  mongo.ts           Conexão e índices do banco PRÓPRIO
  middleware/        Auth (Cognito), correlationId, tratamento de erro
  telemetry/         New Relic
```

Trocar o Mercado Pago por outro provedor significa escrever um novo adaptador
de `PagamentoExternoGateway` — nenhuma linha de caso de uso muda.

### Nenhum serviço acessa o banco de outro

Cumprido por **isolamento de credencial**: o Secret deste serviço no Kubernetes
contém apenas a `MONGO_URI` do banco dele. Não existe credencial que permita a
este serviço abrir o MySQL do OS Service, nem o contrário.

---

## Como rodar localmente

O compose deste repositório depende da rede `oficina-net` e do RabbitMQ criados
pelo compose do OS Service — **suba aquele primeiro**:

```bash
cd fiap-tc-ms-os       && docker compose up -d --build
cd ../fiap-tc-ms-billing && docker compose up -d --build
```

| Endereço | O quê |
| --- | --- |
| http://localhost:3001/api-docs | Swagger deste serviço |
| http://localhost:15672 | Painel do RabbitMQ (`guest` / `guest`) |

### Sem Docker

```bash
npm ci
cp .env.example .env     # ajuste MONGO_URI e RABBITMQ_URL
npm run dev
```

---

## Testes e cobertura

```bash
npm test               # unitários
npm run test:coverage  # unitários + cobertura (falha abaixo de 80%)
npm run test:bdd       # cenários Gherkin (Cucumber)
npm run test:all       # tudo
```

**Resultado desta entrega — 115 testes em 7 suítes:**

| Métrica | Cobertura |
| --- | --- |
| Statements | **95,22%** |
| Branches | **82,78%** |
| Functions | **91,66%** |
| Lines | **95,57%** |

O patamar de 80% nas quatro métricas está em `coverageThreshold`
(`jest.config.js`): o Jest encerra com erro se a cobertura cair, e o pipeline
falha com ele.

Destaques do que é testado:

- **Entidades**: cálculo do valor total, transições de status do orçamento e do
  pagamento, recusa de transições inválidas.
- **Participação na Saga**: cada comando e cada compensação, incluindo
  compensar o que nunca existiu e compensar duas vezes (um estorno repetido
  devolveria dinheiro em dobro — a idempotência é verificada contra o provedor).
- **Mercado Pago**: tradução dos nove status, chave de idempotência enviada,
  erro de comunicação traduzido em `502` sem vazar a mensagem técnica do
  provedor, e o circuit breaker abrindo e reiniciando o contador após sucesso.
- **Adaptadores Mongo**: serialização e reidratação do agregado com os itens
  embutidos, consultas por todas as chaves de negócio, erro de chave duplicada
  absorvido e erro de conexão propagado.
- **Consumidor**: reentrega, incremento de tentativa, *dead letter*, duplicata
  descartada, payload inválido rejeitado sem reenfileirar.
- **Autenticação**: 401 genérico (sem revelar o motivo) e 503 quando o Cognito
  não está configurado — nunca liberar a rota.

Os testes dos adaptadores usam um dublê da `Collection` do MongoDB
(`tests/apoio/ColecaoFake.ts`) em vez de `mongodb-memory-server`, que baixaria
cerca de 100 MB a cada execução do pipeline para validar serialização de
documentos.

### BDD

`tests/bdd/features/orcamento_pagamento.feature`, 8 cenários em Gherkin
português:

```gherkin
Cenario: Estorno repetido nao devolve dinheiro duas vezes
  Dado que o orcamento da Saga ja foi gerado no valor de 450.00
  E que o pagamento da Saga ja foi aprovado
  Quando o orquestrador envia a compensacao para estornar o pagamento por "Execucao falhou"
  E o orquestrador reenvia a compensacao para estornar o pagamento por "Execucao falhou"
  Entao o pagamento deve estar com o status "ESTORNADO"
  E deve existir 1 estorno registrado no provedor de pagamentos
```

---

## CI/CD e Kubernetes

Pipeline **independente** deste repositório (`.github/workflows/`):

**`ci.yml`** — *status check* obrigatório da branch protegida `main`: typecheck,
build, `test:coverage` com gate de 80%, `test:bdd`, renderização dos overlays
do Kustomize, build da imagem e job de **SonarQube com Quality Gate**.

**`deploy.yml`** — merge em `develop` → homologação (`fiap-hml`); merge em
`main` → produção (`fiap-prd`). A imagem vai para o **Amazon ECR** com a tag do
SHA, o Secret é montado a partir do **AWS Systems Manager Parameter Store** e o
job aguarda o `rollout status` no **EKS**.

```
k8s/base/            configmap, deployment, service, hpa
k8s/overlays/hml/    namespace fiap-hml, 1 réplica, MERCADO_PAGO_MOCK=true
k8s/overlays/prd/    namespace fiap-prd, 2 réplicas, MERCADO_PAGO_MOCK=false
```

```bash
npm run k8s:render:hml
npm run k8s:render:prd
```

Este serviço **não tem** `initContainer` de migrations: os índices do MongoDB
são criados no bootstrap da aplicação.

---

## Observabilidade

- **New Relic APM** com *distributed tracing*: o `correlationId` que entra pela
  fila é o mesmo da requisição HTTP que originou a Saga no OS Service.
- **Eventos de negócio**: `SagaComandoRecebido`, `PagamentoRegistrado`,
  `PagamentoEstornado`, `IntegracaoFalha`.
- **Logs estruturados** (pino) com `correlationId` e `sagaId`.
- Sem `NEW_RELIC_LICENSE_KEY` o agente não é carregado e a telemetria cai para
  log.

O evento que merece alerta: `IntegracaoFalha` com `integracao: mercado-pago` —
provedor fora durante uma compensação significa dinheiro a reconciliar.

---

## Documentação da API

- **Swagger UI**: `/api-docs`
- **OpenAPI (JSON)**: `/api-docs.json`
- **Postman**: [`postman/fiap-tc-ms-billing.postman_collection.json`](postman/)

---

## Variáveis de ambiente

Ver [`.env.example`](.env.example). As sensíveis (`MONGO_URI`, `RABBITMQ_URL`,
token e segredo do Mercado Pago, licença do New Relic, IDs do Cognito) vêm do
Secret do Kubernetes em homologação e produção — nunca de arquivo versionado.
