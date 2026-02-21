import { db } from "../db/index.js";
import { users } from "../db/schema.js";
import bcrypt from "bcrypt";
import nodemailer from "nodemailer";
import { randomUUID } from "crypto";
import { eq } from "drizzle-orm";

export async function loginService(email, password) {
  const emailLc = email.trim().toLowerCase();

  const user = await db
    .select()
    .from(users)
    .where(eq(users.email, emailLc))
    .limit(1);

  if (!user.length) {
    return { success: false, error: "No account found with this email." };
  }


  const match = await bcrypt.compare(password, user[0].password);
  if (!match) {
    return { success: false, error: "Incorrect password." };
  }

  return {
    success: true,
    user: {
      id: user[0].id,
      name: user[0].name,
      email: user[0].email,
    },
  };
}

export async function signupService(name, email, password) {
  const emailLc = email.trim().toLowerCase();

  const exists = await db
    .select()
    .from(users)
    .where(eq(users.email, emailLc))
    .limit(1);

  if (exists.length) {
    return {
      success: false,
      error: "An account with this email already exists.",
    };
  }

  const hash = await bcrypt.hash(password, 10);

  const [user] = await db
    .insert(users)
    .values({ name, email: emailLc, password: hash })
    .returning();

  return {
    success: true,
    user: {
      id: user.id,
      name: user.name,
      email: user.email,
    },
  };
}

export async function forgotPasswordService(email) {
  const emailLc = email.trim().toLowerCase();

  const userArr = await db
    .select()
    .from(users)
    .where(eq(users.email, emailLc))
    .limit(1);

  if (!userArr.length) {
    return { success: false, error: "No account found with this email." };
  }

  const user = userArr[0];
  const token = randomUUID();
  const expiry = Date.now() + 60 * 60 * 1000;

  await db
    .update(users)
    .set({ resetToken: token, resetTokenExpiry: expiry })
    .where(eq(users.id, user.id));

  const transporter = nodemailer.createTransport({
    service: "gmail",
    auth: {
      user: process.env.SMTP_USER,
      pass: process.env.SMTP_PASS,
    },
  });

   await transporter.sendMail({
      to: email,
      subject: "Reset Your Password for GraphCareers",
      text: `Hello ${user.name || "User"},\n\nWe received a request to reset your password for your GraphCareers account.\n\nTo reset your password, please click the link below or paste it into your browser:\n\n${process.env.FRONTEND_URL}/reset-password?token=${token}\n\nIf you did not request a password reset, please ignore this email.\n\nThis link will expire in 1 hour for your security.\n\nBest regards,\nThe GraphCareers Team`,
      html: `<p>Hello ${user.name || "User"},</p><p>We received a request to reset your password for your <b>GraphCareers</b> account.</p><p><a href="${process.env.FRONTEND_URL}/reset-password?token=${token}">Click here to reset your password</a></p><p>If you did not request a password reset, please ignore this email.</p><p>This link will expire in 1 hour for your security.</p><p>Best regards,<br/>The GraphCareers Team</p>`,
    });

  return { success: true };
}