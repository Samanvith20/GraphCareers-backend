import { Router } from "express";
import { authMiddleware } from "../middleware/auth.js";
import { getCareerProgression } from "../controllers/careerProgression.controller.js";
import { applyRateLimit } from "../middleware/applyRateLimit.js";
import { careerProgressionLimiter } from "../middleware/rateLimiters/career.limiters.js";

const router=Router()
const userKey = (req) => `user:${req.userId}`;

router.post(
  "/",
  authMiddleware,
  applyRateLimit(careerProgressionLimiter, userKey),
  getCareerProgression
);

export default router