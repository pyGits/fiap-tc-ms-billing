import path from "path";
import swaggerJsdoc from "swagger-jsdoc";

const options = {
  definition: {
    openapi: "3.0.0",
    info: {
      title: "FIAP Tech Challenge - Billing Service",
      version: "1.0.0",
      description: [
        "Microsservico de Orcamento e Pagamento.",
        "",
        "E um PARTICIPANTE da Saga: recebe comandos do OS Service pela fila",
        "saga.billing.comandos e responde em saga.os.reply. Os comandos vem em",
        "pares - GERAR_ORCAMENTO/CANCELAR_ORCAMENTO e",
        "REGISTRAR_PAGAMENTO/ESTORNAR_PAGAMENTO - e o segundo de cada par e a",
        "transacao compensatoria do primeiro.",
        "",
        "As rotas REST abaixo sao apenas de CONSULTA (mais o webhook do",
        "provedor de pagamentos): nenhum orcamento ou pagamento e criado por",
        "HTTP, so por mensagem da Saga.",
      ].join("\n"),
    },
    servers: [{ url: "/", description: "Servidor atual" }],
    components: {
      securitySchemes: {
        bearerAuth: { type: "http", scheme: "bearer", bearerFormat: "JWT" },
      },
      schemas: {
        Erro: {
          type: "object",
          properties: {
            erro: {
              type: "object",
              properties: {
                codigo: { type: "string", example: "orcamento.nao.encontrado" },
                descricao: { type: "string", example: "Orcamento nao encontrado." },
              },
            },
          },
        },
      },
    },
  },
  // O glob do swagger-jsdoc exige barras normais, inclusive no Windows; sem a
  // normalizacao a lista de rotas volta vazia em desenvolvimento local.
  apis: [
    path.join(__dirname, "routes", "*.js").split(path.sep).join("/"),
    path.join(__dirname, "routes", "*.ts").split(path.sep).join("/"),
  ],
};

export const swaggerSpec = swaggerJsdoc(options);
export default swaggerSpec;
