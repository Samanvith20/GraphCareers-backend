import crypto from "crypto";
import { eq } from "drizzle-orm";
import { db } from "../db/index.js";
import { payments, users } from "../db/schema.js";
import { razorpay } from "../lib/razorpay.js";
import logger from "../logger/logger.js";

const PRO_PRICE = 9900; // ₹99 in paise

// ─── Shared pro-upgrade fields ────────────────────────────────────────────────
// Single source of truth — used in both webhook and verify fallback
function proUpgradeFields() {
  return {
    tier:            "pro",
    planExpiresAt:   new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
    credits:         100,
    lastCreditReset: new Date(),
  };
}



export const paymentService = {

  // ── CREATE ORDER ────────────────────────────────────────────────────────────
  async createOrder(userId, idempotencyKey) {
    if (!idempotencyKey) {
      throw new Error("Idempotency key required");
    }

    const user = await db.query.users.findFirst({
      where:   eq(users.id, userId),
      columns: { id: true, tier: true, planExpiresAt: true },
    });

    if (!user) throw new Error("User not found");

    // Already active pro — don't create a duplicate order
    if (
      user.tier === "pro" &&
      user.planExpiresAt &&
      new Date(user.planExpiresAt) > new Date()
    ) {
      return {
        alreadyPro: true,
        message:    "You're already on the Pro plan",
      };
    }

    // Idempotency — return existing order if key already used
    const existing = await db.query.payments.findFirst({
      where: eq(payments.idempotencyKey, idempotencyKey),
    });

    if (existing) {
      logger.info("Order creation skipped — idempotency key already used", {
        userId,
        idempotencyKey,
        existingOrderId: existing.razorpayOrderId,
      });
      return {
        orderId: existing.razorpayOrderId,
        amount:  existing.amount,
      };
    }

    // Create Razorpay order
    const order = await razorpay.orders.create({
      amount:   PRO_PRICE,
      currency: "INR",
      receipt:  `rcpt_${userId.slice(0, 6)}_${Date.now().toString().slice(-6)}`,
    });

    await db.insert(payments).values({
      userId,
      razorpayOrderId: order.id,
      amount:          order.amount,
      currency:        order.currency,
      status:          "created",
      idempotencyKey,
    });

    return {
      orderId: order.id,
      amount:  order.amount,
      keyId:process.env.RAZORPAY_KEY_ID,
    };
  },

  // ── VERIFY PAYMENT (fallback if webhook missed) ─────────────────────────────
  async verifyPayment(data) {
    const { razorpay_order_id, razorpay_payment_id, razorpay_signature } = data;

    // 1. Verify HMAC signature first — reject tampered requests immediately
    const body              = razorpay_order_id + "|" + razorpay_payment_id;
    const expectedSignature = crypto
      .createHmac("sha256", process.env.RAZORPAY_KEY_SECRET)
      .update(body)
      .digest("hex");

    if (expectedSignature !== razorpay_signature) {
      throw new Error("Invalid payment signature");
    }

    // 2. Confirm captured status directly from Razorpay
    const res = await fetch(
      `https://api.razorpay.com/v1/payments/${razorpay_payment_id}`,
      {
        headers: {
          Authorization:
            "Basic " +
            Buffer.from(
              `${process.env.RAZORPAY_KEY_ID}:${process.env.RAZORPAY_KEY_SECRET}`,
            ).toString("base64"),
        },
      },
    );

    const payment = await res.json();

    if (payment.status !== "captured") {
      throw new Error("Payment not captured");
    }
    logger.info("Payment verified — status confirmed captured", {
      orderId:   razorpay_order_id,
      paymentId: razorpay_payment_id,
    });

    // 3. Fallback recovery — only update if webhook hasn't already done it
    const dbPayment = await db.query.payments.findFirst({
      where: eq(payments.razorpayOrderId, razorpay_order_id),
    });

    if (!dbPayment) throw new Error("Payment record not found");

    if (dbPayment.status !== "paid") {
      await db.update(payments)
        .set({ status: "paid", razorpayPaymentId: razorpay_payment_id })
        .where(eq(payments.id, dbPayment.id));

      await db.update(users)
        .set(proUpgradeFields())
        .where(eq(users.id, dbPayment.userId));

      logger.info("User upgraded to Pro via payment verify fallback", {
        userId:    dbPayment.userId,
        orderId:   razorpay_order_id,
        paymentId: razorpay_payment_id,
      });
    } else {
      logger.info("Payment verify skipped — already processed by webhook", {
        userId:  dbPayment.userId,
        orderId: razorpay_order_id,
      });
    }

    return { success: true };
  },

  // ── WEBHOOK (primary path — Razorpay calls this directly) ──────────────────
  async handleWebhook(rawBody, signature) {
    const expected = crypto
      .createHmac("sha256", process.env.RAZORPAY_WEBHOOK_SECRET)
      .update(rawBody)
      .digest("hex");

    if (expected !== signature) {
      throw new Error("Invalid webhook signature");
    }

    const event = JSON.parse(rawBody.toString());

    if (event.event !== "payment.captured") return;

    const entity = event.payload.payment.entity;

    const payment = await db.query.payments.findFirst({
      where: eq(payments.razorpayOrderId, entity.order_id),
    });

    if (!payment)              return; // unknown order — ignore
    if (payment.status === "paid") {
      logger.info("Webhook payment.captured skipped — already processed", {
        orderId: entity.order_id,
        paymentId: entity.id,
      });
      return; // already processed — idempotent
    }

    await db.update(payments)
      .set({ status: "paid", razorpayPaymentId: entity.id })
      .where(eq(payments.id, payment.id));

    // ✅ Same proUpgradeFields() as verify — credits + reset always set
    await db.update(users)
      .set(proUpgradeFields())
      .where(eq(users.id, payment.userId));

    logger.info("User upgraded to Pro via webhook", {
      userId:    payment.userId,
      orderId:   entity.order_id,
      paymentId: entity.id,
    });
  },
};

