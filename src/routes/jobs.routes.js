import { Router } from "express";
import  { getMatchedJobs, ingestJobsBatch,} from "../controllers/jobs.controller.js";
import { authMiddleware } from "../middleware/auth.js";
import { applyRateLimit } from "../middleware/applyRateLimit.js";
import { matchedJobsLimiter } from "../middleware/rateLimiters/jobs.limiters.js";
import { readPreferences, updatePreferences, listJobRoles } from "../controllers/jobPreferences.controller.js";

const router = Router();
const userKey = (req) => `user:${req.userId}`;
router.get("/preferences", authMiddleware, applyRateLimit(matchedJobsLimiter, userKey), readPreferences);
router.patch("/preferences", authMiddleware, applyRateLimit(matchedJobsLimiter, userKey), updatePreferences);
router.get("/roles", authMiddleware, applyRateLimit(matchedJobsLimiter, userKey), listJobRoles);

router.get(
  "/",
  authMiddleware,
  applyRateLimit(matchedJobsLimiter, userKey),
  getMatchedJobs
);
router.post("/ingest",ingestJobsBatch)
export default router;
