import express from "express";
import {
  upsertJobApplicationController,
  getUserJobApplicationsController,
} from "../controllers/jobAppliaction.controller.js";
import { authMiddleware } from "../middleware/auth.js";
import { userJobUpsertSchema } from "../schemas/jobs.schema.js";
import { validate } from "../middleware/validate.js";
import { jobApplicationsReadLimiter, jobApplicationsWriteLimiter } from "../middleware/rateLimiters/jobs.limiters.js";
import { applyRateLimit } from "../middleware/applyRateLimit.js";

const router = express.Router();
const userKey = (req) => `user:${req.user.id}`;

router.post(
  "/",
  authMiddleware,
  applyRateLimit(jobApplicationsWriteLimiter, userKey),
  validate(userJobUpsertSchema),
  upsertJobApplicationController
);

router.get(
  "/",
  authMiddleware,
  applyRateLimit(jobApplicationsReadLimiter, userKey),
  getUserJobApplicationsController
);

export default router;