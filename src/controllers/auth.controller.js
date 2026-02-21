import {
  loginService,
  signupService,
  forgotPasswordService,
} from "../services/auth.service.js";
import jwt from "jsonwebtoken";

export async function login(req, res) {
  try {
    const { email, password } = req.body;

    const result = await loginService(email, password);

    if (!result.success) {
      return res.status(401).json({ error: result.error });
    }

    const token = jwt.sign(
      { id: result.user.id },
      process.env.JWT_SECRET,
      { expiresIn: "7d" }
    );

    res.cookie("token", token, {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      maxAge: 7 * 24 * 60 * 60 * 1000,
    });

    return res.json({ user: result.user });
  } catch (err) {
    console.error("LOGIN CONTROLLER ERROR 👉", err);
    return res.status(500).json({ error: "Internal server error" });
  }
}

export async function signup(req, res) {
  try {
    const { name, email, password } = req.body;

    const result = await signupService(name, email, password);

    if (!result.success) {
      return res.status(400).json({ error: result.error });
    }

    return res.status(201).json({ user: result.user });
  } catch (err) {
    console.error("SIGNUP CONTROLLER ERROR 👉", err);
    return res.status(500).json({ error: "Internal server error" });
  }
}

export async function forgotPassword(req, res) {
  try {
    const { email } = req.body;

    const result = await forgotPasswordService(email);

    if (!result.success) {
      return res.status(400).json({ error: result.error });
    }

    return res.json({ message: "Password reset email sent" });
  } catch (err) {
    console.error("FORGOT PASSWORD ERROR 👉", err);
    return res.status(500).json({ error: "Internal server error" });
  }
}