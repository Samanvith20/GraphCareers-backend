// ─── payment.controller.js ───────────────────────────────────────────────────
import logger from "../logger/logger.js";
import { paymentService } from "../services/payment.service.js";

export const paymentController = {

  // ── CREATE ORDER ────────────────────────────────────────────────────────────
  async createOrder(req, res, next) {
    const requestId = req.requestId;
    const userId    = req.userId;

    try {
      const { idempotencyKey } = req.body;

      logger.info("Create order started", { requestId, userId });

      if (!idempotencyKey) {
        logger.warn("Create order missing idempotencyKey", { requestId, userId });
        return res.status(400).json({ error: "idempotencyKey is required" });
      }

      const result = await paymentService.createOrder(userId, idempotencyKey);

      if (result?.alreadyPro) {
        logger.info("Create order skipped — user already Pro", { requestId, userId });
        return res.status(200).json({ success: false, message: result.message });
      }

      logger.info("Create order success", {
        requestId,
        userId,
        orderId: result.orderId,
        amount:  result.amount,
      });

      res.json(result);

    } catch (err) {
      logger.error("Create order failed", {
        requestId,
        userId,
        error: err.message,
      });
      next(err);
    }
  },

  // ── VERIFY PAYMENT ──────────────────────────────────────────────────────────
  async verifyPayment(req, res, next) {
    const requestId = req.requestId;
    const userId    = req.userId;

    try {
      const { razorpay_order_id, razorpay_payment_id } = req.body;

      logger.info("Verify payment started", {
        requestId,
        userId,
        orderId:   razorpay_order_id,
        paymentId: razorpay_payment_id,
      });

      const result = await paymentService.verifyPayment(req.body);

      logger.info("Verify payment success", {
        requestId,
        userId,
        orderId: razorpay_order_id,
      });

      res.json(result);

    } catch (err) {
      logger.error("Verify payment failed", {
        requestId,
        userId,
        error: err.message,
      });
      next(err);
    }
  },

  // ── WEBHOOK ─────────────────────────────────────────────────────────────────
  async webhook(req, res, next) {
    const requestId = req.requestId;

    try {
      const signature = req.headers["x-razorpay-signature"];

      // req.body is a Buffer here (express.raw middleware)
      // Log the event type without parsing — safe even if body is malformed
      let eventType = "unknown";
      try {
        eventType = JSON.parse(req.body.toString()).event ?? "unknown";
      } catch {}

      logger.info("Webhook received", { requestId, eventType });

      if (!signature) {
        logger.warn("Webhook missing signature header", { requestId });
        return res.sendStatus(400);
      }

      await paymentService.handleWebhook(req.body, signature);

      logger.info("Webhook processed", { requestId, eventType });

      // Always 200 — Razorpay retries on non-2xx, causing the flood you saw
      res.sendStatus(200);

    } catch (err) {
      logger.error("Webhook failed", {
        requestId,
        error: err.message,
      });

      // Still 200 — don't let Razorpay retry a bad-signature request forever
      // For genuine processing errors you may want 500, but signature failures
      // should silently 200 to avoid log spam from replays
      if (err.message === "Invalid webhook signature") {
        return res.sendStatus(200);
      }

      next(err);
    }
  },
};