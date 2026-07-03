import logger from "../logger/logger.js";
import {
  loginService,
  signupService,
  forgotPasswordService,
  profileService,
  resetPasswordService,
  googleAuthService,
} from "../services/auth.service.js";
import jwt from "jsonwebtoken";

export async function login(req, res, next) {
  try {
    const { email, password } = req.body;

    const user = await loginService(email, password);

    const token = jwt.sign({ id: user.id }, process.env.JWT_SECRET, {
      expiresIn: "7d",
    });

    const isProd = process.env.NODE_ENV === "production";

    res.cookie("token", token, {
      httpOnly: true,
      secure: isProd,
      sameSite: isProd ? "none" : "lax",
      maxAge: 7 * 24 * 60 * 60 * 1000,
    });

    logger.info("User login successful", {
      requestId: req.requestId,
      userId: user.id,
    });

    return res.json({ user });
  } catch (err) {
    next(err);
  }
}

export async function signup(req, res, next) {
  try {
    const { name, email, password } = req.body;

    const user = await signupService(name, email, password);

    logger.info("User signup successful", {
      requestId: req.requestId,
      userId: user.id,
    });

    return res.status(201).json({ user });
  } catch (err) {
    next(err);
  }
}

export const googleAuth = async (req, res, next) => {
  try {
    const { token } = req.body;

    const user = await googleAuthService(token);

    const jwtToken = jwt.sign(
      { id: user.id },
      process.env.JWT_SECRET,
      { expiresIn: "7d" }
    );

    const isProd = process.env.NODE_ENV === "production";

    res.cookie("token", jwtToken, {
      httpOnly: true,
      secure: isProd,
      sameSite: isProd ? "none" : "lax",
      maxAge: 7 * 24 * 60 * 60 * 1000,
    });

    logger.info("Google OAuth login successful", {
      requestId: req.requestId,
      userId: user.id,
    });

    return res.json({ user });
  } catch (err) {
    next(err);
  }
};

export async function forgotPassword(req, res, next) {
  try {
    const { email } = req.body;

    await forgotPasswordService(email);

    logger.info("Password reset email dispatched", {
      requestId: req.requestId,
      // Note: we log that an email was sent, but NOT the email address itself in prod
    });

    return res.json({ message: "Password reset email sent" });
  } catch (err) {
    next(err);
  }
}

export async function resetPasswordController(req, res, next) {
  try {
    const { token, password } = req.body;

    await resetPasswordService(token, password);

    logger.info("Password reset completed", {
      requestId: req.requestId,
    });

    return res.json({
      success: true,
      message: "Password reset successfully. You can now log in.",
    });
  } catch (err) {
    next(err);
  }
}

export async function me(req, res, next) {
  try {
    const user = await profileService(req.userId);

    return res.json({ user });
  } catch (err) {
    next(err);
  }
}
