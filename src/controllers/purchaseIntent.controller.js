import { db } from "../db/index.js";
import { purchaseIntents } from "../db/schema.js";
import logger from "../logger/logger.js";
import crypto from "crypto";

export const purchaseIntentController = {
  async saveIntent(req, res, next) {
    try {
      const { featureType, packName, price, intent, reason } = req.body;
      const userId = req.userId; // From authMiddleware

      await db.insert(purchaseIntents).values({
        id: crypto.randomUUID(),
        userId,
        featureType,
        packName,
        price,
        intent,
        reason: reason || null,
      });

      logger.info("Purchase intent saved", {
        requestId: req.requestId,
        userId,
        featureType,
        intent,
      });

      return res.status(200).json({
        success: true,
        message: "Purchase intent saved successfully.",
      });
    } catch (error) {
      logger.error("DB Insert Error", { error: error, message: error.message, stack: error.stack, cause: error.cause });
      next(error);
    }
  },
};
