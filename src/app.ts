import cors from "cors";
import express, { Express } from "express";
import swaggerUi from "swagger-ui-express";

import { Container } from "./container";
import { correlationIdMiddleware } from "./middleware/correlationId";
import { criarErrorHandler, notFoundHandler } from "./middleware/errorHandler";
import {
  criarOrcamentoRoutes,
  criarPagamentoRoutes,
  criarWebhookRoutes,
} from "./routes/billing.routes";
import { swaggerSpec } from "./swagger";

export function criarApp(container: Container): Express {
  const app = express();

  app.use(cors());
  app.use(express.json());
  app.use(correlationIdMiddleware);

  app.get("/", (_req, res) => {
    res.json({
      servico: "fiap-tc-ms-billing",
      papel: "participante da Saga (orcamento e pagamento)",
      documentacao: "/api-docs",
    });
  });

  app.get("/health", (_req, res) => {
    res.status(200).json({ status: "ok", servico: "fiap-tc-ms-billing" });
  });

  app.use("/orcamentos", criarOrcamentoRoutes(container));
  app.use("/pagamentos", criarPagamentoRoutes(container));
  app.use("/webhooks", criarWebhookRoutes(container));

  app.get("/api-docs.json", (_req, res) => {
    res.json(swaggerSpec);
  });
  app.use("/api-docs", swaggerUi.serve, swaggerUi.setup(swaggerSpec));

  app.use(notFoundHandler);
  app.use(criarErrorHandler(container.telemetria));

  return app;
}

export default criarApp;
