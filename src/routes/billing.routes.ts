import { Router } from "express";
import { Container } from "../container";
import { authMiddleware } from "../middleware/auth";

/**
 * @openapi
 * tags:
 *   - name: Orcamentos
 *     description: Orcamentos gerados a partir dos itens da ordem de servico
 *   - name: Pagamentos
 *     description: Cobranca e estorno (integracao com o Mercado Pago)
 */

export function criarOrcamentoRoutes(container: Container): Router {
  const router = Router();

  /**
   * @openapi
   * /orcamentos:
   *   get:
   *     summary: Lista orcamentos
   *     tags: [Orcamentos]
   *     security: [{ bearerAuth: [] }]
   *     parameters:
   *       - in: query
   *         name: status
   *         schema: { type: string, enum: [GERADO, APROVADO, RECUSADO, CANCELADO] }
   *     responses:
   *       200: { description: Lista de orcamentos }
   */
  router.get("/", authMiddleware, async (req, res, next) => {
    try {
      res.json(
        await container.consultarOrcamento.listar(
          req.query.status as string | undefined,
        ),
      );
    } catch (erro) {
      next(erro);
    }
  });

  /**
   * @openapi
   * /orcamentos/ordem-servico/{ordemServicoId}:
   *   get:
   *     summary: Consulta o orcamento de uma ordem de servico
   *     description: |
   *       Caminho usado pelo cliente antes de aprovar. Note que o Billing nao
   *       consulta o banco do OS Service: ele guarda a propria copia dos dados
   *       que recebeu pela mensagem do comando.
   *     tags: [Orcamentos]
   *     security: [{ bearerAuth: [] }]
   *     parameters:
   *       - in: path
   *         name: ordemServicoId
   *         required: true
   *         schema: { type: string, format: uuid }
   *     responses:
   *       200: { description: Orcamento encontrado }
   *       404: { description: Nao existe orcamento para esta ordem de servico }
   */
  router.get(
    "/ordem-servico/:ordemServicoId",
    authMiddleware,
    async (req, res, next) => {
      try {
        res.json(
          await container.consultarOrcamento.porOrdemServico(
            String(req.params.ordemServicoId),
          ),
        );
      } catch (erro) {
        next(erro);
      }
    },
  );

  /**
   * @openapi
   * /orcamentos/{id}:
   *   get:
   *     summary: Consulta um orcamento
   *     tags: [Orcamentos]
   *     security: [{ bearerAuth: [] }]
   *     parameters:
   *       - in: path
   *         name: id
   *         required: true
   *         schema: { type: string, format: uuid }
   *     responses:
   *       200: { description: Orcamento encontrado }
   *       404: { description: Orcamento nao encontrado }
   */
  router.get("/:id", authMiddleware, async (req, res, next) => {
    try {
      res.json(await container.consultarOrcamento.porId(String(req.params.id)));
    } catch (erro) {
      next(erro);
    }
  });

  return router;
}

export function criarPagamentoRoutes(container: Container): Router {
  const router = Router();

  /**
   * @openapi
   * /pagamentos:
   *   get:
   *     summary: Lista pagamentos
   *     tags: [Pagamentos]
   *     security: [{ bearerAuth: [] }]
   *     parameters:
   *       - in: query
   *         name: status
   *         schema: { type: string, enum: [PENDENTE, APROVADO, RECUSADO, ESTORNADO] }
   *     responses:
   *       200: { description: Lista de pagamentos }
   */
  router.get("/", authMiddleware, async (req, res, next) => {
    try {
      res.json(
        await container.consultarPagamento.listar(
          req.query.status as string | undefined,
        ),
      );
    } catch (erro) {
      next(erro);
    }
  });

  /**
   * @openapi
   * /pagamentos/ordem-servico/{ordemServicoId}:
   *   get:
   *     summary: Consulta o pagamento de uma ordem de servico
   *     tags: [Pagamentos]
   *     security: [{ bearerAuth: [] }]
   *     parameters:
   *       - in: path
   *         name: ordemServicoId
   *         required: true
   *         schema: { type: string, format: uuid }
   *     responses:
   *       200: { description: Pagamento encontrado }
   *       404: { description: Nao existe pagamento para esta ordem de servico }
   */
  router.get(
    "/ordem-servico/:ordemServicoId",
    authMiddleware,
    async (req, res, next) => {
      try {
        res.json(
          await container.consultarPagamento.porOrdemServico(
            String(req.params.ordemServicoId),
          ),
        );
      } catch (erro) {
        next(erro);
      }
    },
  );

  /**
   * @openapi
   * /pagamentos/{id}:
   *   get:
   *     summary: Consulta um pagamento
   *     tags: [Pagamentos]
   *     security: [{ bearerAuth: [] }]
   *     parameters:
   *       - in: path
   *         name: id
   *         required: true
   *         schema: { type: string, format: uuid }
   *     responses:
   *       200: { description: Pagamento encontrado }
   *       404: { description: Pagamento nao encontrado }
   */
  router.get("/:id", authMiddleware, async (req, res, next) => {
    try {
      res.json(await container.consultarPagamento.porId(String(req.params.id)));
    } catch (erro) {
      next(erro);
    }
  });

  return router;
}

// Webhook do Mercado Pago.
//
// Nao usa o authMiddleware: quem chama e o provedor, nao um usuario do nosso
// Cognito. A autenticidade e verificada pelo segredo compartilhado no header.
export function criarWebhookRoutes(container: Container): Router {
  const router = Router();

  /**
   * @openapi
   * /webhooks/mercado-pago:
   *   post:
   *     summary: Notificacao assincrona do Mercado Pago
   *     description: |
   *       Recebe a confirmacao de pagamento quando a cobranca e aprovada depois
   *       da resposta inicial (caso tipico do Pix). Responde 200 sempre que a
   *       notificacao e aceita, para o provedor nao reenviar indefinidamente.
   *     tags: [Pagamentos]
   *     requestBody:
   *       required: true
   *       content:
   *         application/json:
   *           schema:
   *             type: object
   *             properties:
   *               type: { type: string, example: payment }
   *               data:
   *                 type: object
   *                 properties:
   *                   id: { type: string }
   *     responses:
   *       200: { description: Notificacao recebida }
   *       401: { description: Assinatura do webhook invalida }
   */
  router.post("/mercado-pago", async (req, res, next) => {
    try {
      const segredo = process.env.MERCADO_PAGO_WEBHOOK_SECRET;
      if (segredo && req.headers["x-webhook-secret"] !== segredo) {
        return res.status(401).json({
          erro: {
            codigo: "webhook.nao.autorizado",
            descricao: "Assinatura do webhook invalida.",
          },
        });
      }

      const idExterno = String(req.body?.data?.id ?? "");
      if (!idExterno) {
        return res.status(200).json({ recebido: true, ignorado: true });
      }

      const cobranca = await container.pagamentoExterno.consultar(idExterno);

      return res.status(200).json({
        recebido: true,
        idExterno,
        status: cobranca.status,
      });
    } catch (erro) {
      return next(erro);
    }
  });

  return router;
}
