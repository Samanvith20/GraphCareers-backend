import express from "express";
import { optimizeResumeTrigger, getOptimizationStatus, downloadPdf, downloadDocx } from "../controllers/resumeIntelligence.controller.js";
import { authMiddleware } from "../middleware/auth.js";
import { 
  resumeIntelligenceTriggerLimiter, 
  resumeIntelligenceDeleteLimiter 
} from "../middleware/rateLimiters/resumeIntelligence.limiters.js";

const router = express.Router();

router.use(authMiddleware);

// Trigger optimization for a specific job match
router.post("/:jobSourceId/optimize", resumeIntelligenceTriggerLimiter, optimizeResumeTrigger);

// Check optimization status and get results
router.get("/:jobSourceId/status", getOptimizationStatus);

// Downloads
router.get("/:jobSourceId/download/pdf", downloadPdf);
router.get("/:jobSourceId/download/docx", downloadDocx);

export default router;
