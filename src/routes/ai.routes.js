import { Router } from "express";
import { authMiddleware } from "../middleware/auth.js";
import { chatController } from "../controllers/ai.controller.js";

const router = Router();

router.post("/chat", authMiddleware, chatController)
export default router;