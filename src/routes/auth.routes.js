import { Router } from "express";
import {
  login,
  signup,
  forgotPassword,
  me,
} from "../controllers/auth.controller.js";

import { validate } from "../middleware/validate.js";
import {
  loginSchema,
  signupSchema,
  forgotPasswordSchema,
} from "../schemas/auth.schema.js";
import { authMiddleware } from "../middleware/auth.js";

const router = Router();

// POST /api/auth/login
router.post("/login", validate(loginSchema), login);

// POST /api/auth/signup
router.post("/signup", validate(signupSchema), signup);

// POST /api/auth/forgot-password
router.post("/forgot-password", validate(forgotPasswordSchema), forgotPassword);

router.get("/me",authMiddleware, me);

export default router;
