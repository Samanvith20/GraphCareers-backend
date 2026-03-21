import crypto from "crypto";
import { eq } from "drizzle-orm"
import { db } from "../db/index.js";
import { payments, users } from "../db/schema.js";
import { razorpay } from "../lib/razorpay.js";

const PRO_PRICE = 9900; // ₹99 in paise

export const paymentService = {
  // 🔥 CREATE ORDER
  async createOrder(userId, idempotencyKey) {
    if (!idempotencyKey) {
      throw new Error("Idempotency key required");
    }

    // 1. Check user
    const user = await db.query.users.findFirst({
      where: eq(users.id, userId),
    });

    if (!user) throw new Error("User not found");

    // 2. Prevent duplicate purchase
    if (
  user.tier === "pro" &&
  user.planExpiresAt &&
  new Date(user.planExpiresAt) > new Date()
) {
  return {
    alreadyPro: true,
    message: "You are already on Pro plan",
  };
}

    // 3. Idempotency check
    const existing = await db.query.payments.findFirst({
      where: eq(payments.idempotencyKey, idempotencyKey),
    });

    if (existing) {
      return {
        orderId: existing.razorpayOrderId,
        amount: existing.amount,
      };
    }

    // 4. Create Razorpay order
    const order = await razorpay.orders.create({
      amount: PRO_PRICE,
      currency: "INR",
     receipt: `rcpt_${userId.slice(0, 6)}_${Date.now().toString().slice(-6)}`,
    });

    // 5. Save in DB
    await db.insert(payments).values({
      userId,
      razorpayOrderId: order.id,
      amount: order.amount,
      currency: order.currency,
      status: "created",
      idempotencyKey,
    });

    return {
      orderId: order.id,
      amount: order.amount,
    };
  },

  // 🔐 VERIFY PAYMENT
  async verifyPayment(data) {
  const {
    razorpay_order_id,
    razorpay_payment_id,
    razorpay_signature,
  } = data;

  const body = razorpay_order_id + "|" + razorpay_payment_id;

  const expectedSignature = crypto
    .createHmac("sha256", process.env.RAZORPAY_KEY_SECRET)
    .update(body)
    .digest("hex");

  if (expectedSignature !== razorpay_signature) {
    throw new Error("Invalid signature");
  }

  // 🔥 Fetch from Razorpay
  const res = await fetch(
    `https://api.razorpay.com/v1/payments/${razorpay_payment_id}`,
    {
      headers: {
        Authorization:
          "Basic " +
          Buffer.from(
            process.env.RAZORPAY_KEY_ID +
              ":" +
              process.env.RAZORPAY_KEY_SECRET
          ).toString("base64"),
      },
    }
  );
  

  const payment = await res.json();
  console.log("res from api of verify payment", payment)

  if (payment.status !== "captured") {
    throw new Error("Payment not captured");
  }

  // 🔥 FALLBACK (ONLY IF WEBHOOK FAILED)
  const dbPayment = await db.query.payments.findFirst({
    where: eq(payments.razorpayOrderId, razorpay_order_id),
  });

  if (!dbPayment) throw new Error("Payment not found");

  if (dbPayment.status !== "paid") {
    // 🔥 RECOVERY LOGIC
    await db.update(payments)
      .set({
        status: "paid",
        razorpayPaymentId: razorpay_payment_id,
      })
      .where(eq(payments.id, dbPayment.id));

    await db.update(users)
      .set({
        tier: "pro",
        planExpiresAt: new Date(Date.now() + 30*24*60*60*1000),
      })
      .where(eq(users.id, dbPayment.userId));
  }

  return { success: true };
},

  // 🔁 WEBHOOK
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

  if (!payment) return;

  if (payment.status === "paid") return;

  await db.update(payments)
    .set({
      status: "paid",
      razorpayPaymentId: entity.id,
    })
    .where(eq(payments.id, payment.id));

  await db.update(users)
    .set({
      tier: "pro",
      planExpiresAt: new Date(Date.now() + 30*24*60*60*1000),
    })
    .where(eq(users.id, payment.userId));
}
};