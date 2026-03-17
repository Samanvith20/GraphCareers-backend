import { Router } from "express";
import {
  login,
  signup,
  forgotPassword,
  me,
  resetPasswordController,
  googleAuth,
} from "../controllers/auth.controller.js";

import { validate } from "../middleware/validate.js";
import {
  loginSchema,
  signupSchema,
  forgotPasswordSchema,
  resetPasswordSchema,
} from "../schemas/auth.schema.js";
import { authMiddleware } from "../middleware/auth.js";
import { fingerprintMiddleware } from "../middleware/fingerprint.js";
import { applyRateLimit } from "../middleware/applyRateLimit.js";
import {
  forgotPasswordLimiter,
  loginLimiter,
  signupLimiter,
} from "../middleware/rateLimiters/auth.limiters.js";

const router = Router();
router.use(fingerprintMiddleware);

// POST /api/auth/login
router.post(
  "/login",
  applyRateLimit(
    loginLimiter,
    (req) => `${req.ip}:${req.fingerprint}:${req.body?.email || "no-email"}`,
  ),
  validate(loginSchema),
  login,
);
router.post("/google",googleAuth)

// POST /api/auth/signup
router.post(
  "/signup",
  applyRateLimit(signupLimiter, (req) => `${req.ip}:${req.fingerprint}`),
  validate(signupSchema),
  signup,
);

// POST /api/auth/forgot-password
router.post(
  "/forgot-password",
  applyRateLimit(
    forgotPasswordLimiter,
    (req) => `${req.ip}:${req.fingerprint}`,
  ),
  validate(forgotPasswordSchema),
  forgotPassword,
);

router.post(
  "/reset-password",
  validate(resetPasswordSchema),
  resetPasswordController,
);
router.post("/logout", authMiddleware, (req, res) => {
  res.clearCookie("token");
  return res.json({ message: "Logged out successfully" });
});


router.get("/me", authMiddleware, me);

export default router;
