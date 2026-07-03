import express from "express";
import { optimizeResumeTrigger, getOptimizationStatus, downloadPdf, downloadDocx } from "../controllers/resumeIntelligence.controller.js";
import { authMiddleware } from "../middleware/auth.js";
import { 
  resumeIntelligenceTriggerLimiter, 
  resumeIntelligenceDeleteLimiter 
} from "../middleware/rateLimiters/resumeIntelligence.limiters.js";
import { applyRateLimit } from "../middleware/applyRateLimit.js";

const router = express.Router();

router.use(authMiddleware);



// Trigger optimization for a specific job platform
router.post(
  "/:platform/optimize", 
  // applyRateLimit(
  //   resumeIntelligenceTriggerLimiter,
  //   (req) => `${req.user.id}:${req.params.platform}`
  // ), 
  optimizeResumeTrigger
);

// Check optimization status and get results
router.get("/:platform/status", getOptimizationStatus);

// Downloads
router.get("/:platform/download/pdf", downloadPdf);
router.get("/:platform/download/docx", downloadDocx);

export default router;
