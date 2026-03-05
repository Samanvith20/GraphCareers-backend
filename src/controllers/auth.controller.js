import logger from "../logger/logger.js";
import {
  loginService,
  signupService,
  forgotPasswordService,
  profileService,
  resetPasswordService,
} from "../services/auth.service.js";
import jwt from "jsonwebtoken";

export async function login(req, res) {
  try {
    logger.info("Login attempt", {
      requestId: req.requestId,
      email: req.body.email,
    });
    const { email, password } = req.body;

    const result = await loginService(email, password);

    if (!result.success) {
      return res.status(401).json({ error: result.error });
    }

    const token = jwt.sign({ id: result.user.id }, process.env.JWT_SECRET, {
      expiresIn: "7d",
    });

    const isProd = process.env.NODE_ENV === "production";

    res.cookie("token", token, {
      httpOnly: true,
      secure: isProd,
      sameSite: isProd ? "none" : "lax",
      maxAge: 7 * 24 * 60 * 60 * 1000,
    });
    logger.info("Login success", {
      requestId: req.requestId,
    });

    return res.json({ user: result.user });
  } catch (err) {
    logger.error("Login controller failed", {
      requestId: req.requestId,
      error: err.message,
      stack: err.stack,
    });

    return res.status(500).json({ error: "Internal server error" });
  }
}

export async function signup(req, res) {
  try {
    logger.info("signup attempt ", {
      requestId: req.requestId,
      email: req.body.email,
    });
    const { name, email, password } = req.body;

    const result = await signupService(name, email, password);

    if (!result.success) {
      return res.status(400).json({ error: result.error });
    }
    logger.info("user signup success", {
      requestId: req.requestId,
    });
    return res.status(201).json({ user: result.user });
  } catch (err) {
    logger.error("user signup failed", {
      requestId: req.requestId,
      error: err.message,
      stack: err.stack,
    });
    return res.status(500).json({ error: "Internal server error" });
  }
}

export async function forgotPassword(req, res) {
  try {
    logger.info("forgot-password", {
      requestId: req.requestId,
      email: req.body,
    });
    const { email } = req.body;

    const result = await forgotPasswordService(email);

    if (!result.success) {
      return res.status(400).json({ error: result.error });
    }
    logger.info("forgotPassword success", {
      requestId: req.requestId,
    });

    return res.json({ message: "Password reset email sent" });
  } catch (err) {
    logger.error("forgot password failed", {
      requestId: req.requestId,
      error: err.message,
      stack: err.stack,
    });
    return res.status(500).json({ error: "Internal server error" });
  }
}

export async function resetPasswordController(req, res) {
  try {
    const { token, password } = req.body;

    const result = await resetPasswordService(token, password);

    if (!result.success) {
      return res.status(400).json({ error: result.error });
    }
    logger.info("resetpassword success", {
      requestId: req.requestId,
    });

    return res.json({
      success: true,
      message: "Password reset successfully. You can now log in.",
    });
  } catch (error) {
    logger.error("Reset password controller error", {
      requestId: req.requestId,
      error: err.message,
      stack: err.stack,
    });

    return res.status(500).json({ error: "Internal server error" });
  }
}
export async function me(req, res) {
  try {
    const result = await profileService(req.userId);
    if (!result.success) {
      return res.status(401).json({ error: result.error });
    }
    logger.info("me controller success", {
      requestId: req.requestId,
    });
    return res.json({ user: result.user });
  } catch (err) {
    logger.error("ME CONTROLLER ERROR ", {
      requestId: req.requestId,
      error: err.message,
      stack: err.stack,
    });
    return res.status(500).json({ error: "Internal server error" });
  }
}
