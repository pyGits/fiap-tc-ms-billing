import "dotenv/config";
import { Collection, Db, Document, MongoClient } from "mongodb";
import logger from "./logger";

// Banco PROPRIO do Billing Service (MongoDB).
//
// Por que NoSQL de documentos aqui e SQL no OS Service?
//
// O orcamento e o pagamento sao AGREGADOS fechados: o orcamento ja chega com
// os itens embutidos e e sempre lido por inteiro, nunca por juncao com outras
// colecoes. Em um modelo relacional isso exigiria duas tabelas e um join a
// cada leitura; como documento, e um unico registro - leitura e escrita
// atomicas em um so lugar (Aula 1 de "Data Engineering": modele pela forma de
// acesso, nao pela normalizacao).
//
// Ja a Ordem de Servico tem relacionamentos fortes (cliente, veiculo, itens,
// historico) e precisa de consultas agregadas por status, onde o SQL e mais
// natural. Usar os dois modelos tambem atende o requisito explicito da Fase 4.
const URI = process.env.MONGO_URI || "mongodb://localhost:27017";
const NOME_BANCO = process.env.MONGO_DB || "fiap_tc_billing";

let cliente: MongoClient | null = null;
let banco: Db | null = null;

export async function conectarMongo(): Promise<Db> {
  if (banco) return banco;

  cliente = new MongoClient(URI, {
    // Timeouts curtos: um participante da Saga que trava esperando o banco
    // deixa o orquestrador sem resposta e a Saga parada.
    serverSelectionTimeoutMS: Number(process.env.MONGO_TIMEOUT_MS || 5000),
    retryWrites: true,
  });

  await cliente.connect();
  banco = cliente.db(NOME_BANCO);

  await criarIndices(banco);

  logger.info({ banco: NOME_BANCO }, "conectado ao MongoDB");
  return banco;
}

// Indices criados em codigo (e nao a mao): garantem que local, hml e prd
// subam identicos, do mesmo jeito que as migrations fazem no servico de OS.
async function criarIndices(db: Db): Promise<void> {
  await db
    .collection("orcamentos")
    .createIndexes([
      { key: { ordemServicoId: 1 }, name: "idx_orcamento_os" },
      { key: { sagaId: 1 }, name: "idx_orcamento_saga" },
      { key: { status: 1 }, name: "idx_orcamento_status" },
    ]);

  await db
    .collection("pagamentos")
    .createIndexes([
      { key: { orcamentoId: 1 }, name: "idx_pagamento_orcamento" },
      { key: { ordemServicoId: 1 }, name: "idx_pagamento_os" },
      { key: { sagaId: 1 }, name: "idx_pagamento_saga" },
      { key: { status: 1 }, name: "idx_pagamento_status" },
      { key: { idExterno: 1 }, name: "idx_pagamento_externo", sparse: true },
    ]);

  // Chave unica no mensagemId: e o indice que torna a idempotencia dos
  // consumidores a prova de corrida entre duas replicas do pod.
  await db
    .collection("mensagens_processadas")
    .createIndexes([
      { key: { mensagemId: 1 }, name: "uq_mensagem", unique: true },
      // TTL de 7 dias: o controle de duplicidade nao precisa ser eterno.
      {
        key: { processadaEm: 1 },
        name: "ttl_mensagem",
        expireAfterSeconds: 60 * 60 * 24 * 7,
      },
    ]);
}

export function colecao<T extends Document>(nome: string): Collection<T> {
  if (!banco) {
    throw new Error("MongoDB nao conectado: chame conectarMongo() antes.");
  }
  return banco.collection<T>(nome);
}

export async function fecharMongo(): Promise<void> {
  await cliente?.close();
  cliente = null;
  banco = null;
}

export default conectarMongo;
