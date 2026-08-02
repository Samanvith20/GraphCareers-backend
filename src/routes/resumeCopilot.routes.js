import express from "express";
import { authMiddleware } from "../middleware/auth.js";
import { getOptimizationReportHandler, copilotChatHandler } from "../controllers/resumeCopilot.controller.js";

const router = express.Router();

router.use(authMiddleware);

// GET /api/resume/copilot/:versionId/report
router.get("/:versionId/report", getOptimizationReportHandler);

// POST /api/resume/copilot/:versionId/chat
router.post("/:versionId/chat", copilotChatHandler);

export default router;
