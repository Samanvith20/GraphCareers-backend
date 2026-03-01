import { Router } from "express";
import { getMatchedJobs } from "../controllers/jobs.controller.js";
import { authMiddleware } from "../middleware/auth.js";
import { applyRateLimit } from "../middleware/applyRateLimit.js";
import { matchedJobsLimiter } from "../middleware/rateLimiters/jobs.limiters.js";

const router = Router();
const userKey = (req) => `user:${req.userId}`;

router.get(
  "/",
  authMiddleware,
  applyRateLimit(matchedJobsLimiter, userKey),
  getMatchedJobs
);
export default router;
