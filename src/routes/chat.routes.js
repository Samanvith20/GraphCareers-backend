import { Router } from "express";
import { authMiddleware } from "../middleware/auth.js";
import {
  chat,
  deleteSessionHandler,
  getSessionMessages,
  getSessions,
} from "../controllers/chat.controller.js";
import { applyRateLimit } from "../middleware/applyRateLimit.js";
import { chatLimiter } from "../middleware/rateLimiters/chat.limiters.js";

const router = Router();
const userKey = (req) => `user:${req.userId}`;

router.post(
  "/chat",
  authMiddleware,
  applyRateLimit(chatLimiter, userKey),
  chat,
);
router.get("/sessions", authMiddleware, getSessions);
router.get("/sessions/:sessionId/messages", authMiddleware, getSessionMessages);
router.delete("/sessions/:sessionId", authMiddleware, deleteSessionHandler);
export default router;
