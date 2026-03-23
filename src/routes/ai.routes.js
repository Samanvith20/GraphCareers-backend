import { Router } from "express";
import { authMiddleware } from "../middleware/auth.js";
import { chatController } from "../controllers/ai.controller.js";
import { applyRateLimit } from "../middleware/applyRateLimit.js";
import { chatLimiter } from "../middleware/rateLimiters/chat.limiters.js";

const router = Router();
const userKey = (req) => `user:${req.userId}`;

router.post("/chat", authMiddleware,    applyRateLimit(chatLimiter, userKey),chatController)
export default router;