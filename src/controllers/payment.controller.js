import logger from "../logger/logger.js";
import { paymentService } from "../services/payment.service.js";

export const paymentController = {
  // CREATE ORDER
  async createOrder(req, res, next) {
    const requestId = req.requestId;
    const userId = req.userId;

    try {
      const { idempotencyKey } = req.body;

      logger.info("Create order started", {
        requestId,
        userId,
      });

      const result = await paymentService.createOrder(
        userId,
        idempotencyKey,
        
      );


      if (result?.alreadyPro) {
  logger.info("User already on Pro plan", {
    requestId,
    userId,
  });

  return res.status(200).json({
    success: false,
    message: result.message,
  });
}

      res.json(result);
    } catch (err) {
        console.log("err:;",err)
      logger.error("Create order failed", {
        requestId,
        userId,
        error: err.error ||err.message,
      });
      next(err);
    }
  },

  // VERIFY PAYMENT
  async verifyPayment(req, res, next) {
    const requestId = req.requestId;

    try {
      logger.info("Verify payment started", {
        requestId,
      });

      const result = await paymentService.verifyPayment(
        req.body,
        requestId // 🔥 pass
      );

      logger.info("Verify payment success", {
        requestId,
        orderId: req.body.razorpay_order_id,
      });

      res.json(result);
    } catch (err) {
        //console.log("err:;",err)
      logger.error("Verify payment failed", {
        requestId,
        error: err.message,
      });
      next(err);
    }
  },

  // WEBHOOK
  async webhook(req, res,next) {
    const requestId = req.requestId;

    try {
      const signature = req.headers["x-razorpay-signature"];

      logger.info("Webhook received", {
        requestId,
      });

      await paymentService.handleWebhook(
        req.body,
        signature,
        requestId // 🔥 pass
      );

      logger.info("Webhook processed successfully", {
        requestId,
      });

      res.sendStatus(200);
    } catch (err) {
      logger.error("Webhook failed", {
        requestId,
        error: err.message,
      });
      next(err)
    }
  },
};