import { Router } from "express";

import { validate } from "../middleware/validate.js";

import { authMiddleware } from "../middleware/auth.js";
import {
  getUserdetails,
  getuserJobs,
  updateUserProfile,
  uploadUserResume,
} from "../controllers/user.controller.js";
import { updateProfileSchema } from "../schemas/user.schema.js";
import multer from "multer";
import { applyRateLimit } from "../middleware/applyRateLimit.js";
import {
  resumeUploadLimiter,
  userReadLimiter,
  userWriteLimiter,
} from "../middleware/rateLimiters/user.limiters.js";

const router = Router();
const upload = multer({ 
  storage: multer.memoryStorage(),
  //limits: { fileSize: 500 * 1024 } 
 });
const userKey = (req) => `user:${req.userId}`;

router.get(
  "/",
  authMiddleware,
  applyRateLimit(userReadLimiter, userKey),
  getUserdetails,
);
router.get(
  "/job-applications",
  authMiddleware,
  applyRateLimit(userReadLimiter, userKey),
  getuserJobs,
);
router.patch(
  "/update",
  
  authMiddleware,
  applyRateLimit(userWriteLimiter, userKey),
validate(updateProfileSchema),
  updateUserProfile,
);
router.post(
  "/resume-upload",
  authMiddleware,
  applyRateLimit(resumeUploadLimiter, userKey),
  upload.single("resume"),
  uploadUserResume,
);

// ✅ Resume → AI extraction → profile update
// router.post(
//   "/resume-parse",
//   authMiddleware,
//   applyRateLimit(resumeUploadLimiter, userKey),
//   parseUserResumeWithAI,
// );

export default router;
