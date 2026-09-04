import express from "express";
import { authMiddleware } from "../../middleware/auth.js";
import { applyRateLimit } from "../../middleware/applyRateLimit.js";
import {
  resumeAgentChatLimiter,
  resumeAgentMutationLimiter,
  resumeAgentRunLimiter,
  resumeAgentTargetLimiter,
} from "../../middleware/rateLimiters/resumeAgent.limiters.js";
import {
  chatHandler,
  confirmMissingSkillHandler,
  createCareerTargetHandler,
  createManualTargetHandler,
  createPlatformTargetHandler,
  createRunHandler,
  decideProposalHandler,
  downloadVersionHandler,
  getMessagesHandler,
  getRunEventsHandler,
  getRunHandler,
  getTargetHandler,
  getVersionHandler,
  getWorkspaceHandler,
  listToolsHandler,
  listPlatformRolesHandler,
} from "./resumeAgent.controller.js";

const router = express.Router();
router.use(authMiddleware);
const userKey = (req) => req.userId;

router.get("/tools", listToolsHandler);
router.get("/workspace", getWorkspaceHandler);
router.get("/platforms/:platform/roles", applyRateLimit(resumeAgentTargetLimiter, userKey), listPlatformRolesHandler);
router.post("/targets/platform", applyRateLimit(resumeAgentTargetLimiter, userKey), createPlatformTargetHandler);
router.post("/targets/career-page", applyRateLimit(resumeAgentTargetLimiter, userKey), createCareerTargetHandler);
router.post("/targets/manual-jd", applyRateLimit(resumeAgentTargetLimiter, userKey), createManualTargetHandler);
router.get("/targets/:id", getTargetHandler);

router.post("/runs", applyRateLimit(resumeAgentRunLimiter, userKey), createRunHandler);
router.get("/runs/:id", getRunHandler);
router.get("/runs/:id/events", getRunEventsHandler);
router.get("/runs/:id/messages", getMessagesHandler);
router.post("/runs/:id/chat", applyRateLimit(resumeAgentChatLimiter, userKey), chatHandler);
router.post("/runs/:id/missing-skills/confirm", applyRateLimit(resumeAgentMutationLimiter, userKey), confirmMissingSkillHandler);

router.post("/proposals/:id/decision", applyRateLimit(resumeAgentMutationLimiter, userKey), decideProposalHandler);
router.get("/versions/:versionId", getVersionHandler);
router.get("/versions/:versionId/download/:format", downloadVersionHandler);

export default router;
