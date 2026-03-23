// ─── payment.routes.js ───────────────────────────────────────────────────────
import { Router } from "express";
import express from "express";
import { authMiddleware } from "../middleware/auth.js";
import { paymentController } from "../controllers/payment.controller.js";
import { applyRateLimit } from "../middleware/applyRateLimit.js";
import { paymentLimiter } from "../middleware/rateLimiters/payment.limiters.js";

const router = Router();
const userKey = (req) => `user:${req.userId}`;

router.post(
  "/create-order",
  authMiddleware,
  applyRateLimit(paymentLimiter, userKey),
  paymentController.createOrder,
);
router.post(
  "/verify",
  authMiddleware,
  applyRateLimit(paymentLimiter, userKey),
  paymentController.verifyPayment,
);

// ✅ CRITICAL: webhook must receive the raw body as a Buffer.
// express.json() parses it into an object BEFORE the route handler runs,
// which breaks crypto.createHmac().update() — it needs string or Buffer.
// express.raw() bypasses the global JSON middleware for this route only.
router.post(
  "/webhook",
  express.raw({ type: "application/json" }),
  paymentController.webhook,
);

export default router;
