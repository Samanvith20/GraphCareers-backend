import { Router } from "express";
import { authMiddleware } from "../middleware/auth.js";
import { validate } from "../middleware/validate.js";
import { purchaseIntentSchema } from "../schemas/purchaseIntent.schema.js";
import { purchaseIntentController } from "../controllers/purchaseIntent.controller.js";

const router = Router();

router.post(
  "/",
  authMiddleware,
  validate(purchaseIntentSchema),
  purchaseIntentController.saveIntent
);

export default router;
