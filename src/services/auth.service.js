import { db } from "../db/index.js";
import { users } from "../db/schema.js";
import bcrypt from "bcrypt";
import nodemailer from "nodemailer";
import { randomUUID } from "crypto";
import { and, eq, gt } from "drizzle-orm";
import { OAuth2Client } from "google-auth-library";


const client = new OAuth2Client(process.env.GOOGLE_CLIENT_ID);

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



export async function googleAuthService(token) {

  const ticket = await client.verifyIdToken({
    idToken: token,
    audience: process.env.GOOGLE_CLIENT_ID,
  });

  const payload = ticket.getPayload();

  const emailLc = payload.email.trim().toLowerCase();

  const { name, picture, sub } = payload;

  // check if user exists
  const existing = await db
    .select()
    .from(users)
    .where(eq(users.email, emailLc))
    .limit(1);

  let user;

  if (existing.length) {
    user = existing[0];
  } else {
    const [newUser] = await db
      .insert(users)
      .values({
        name,
        email: emailLc,
        googleId: sub,
        avatar: picture,
        provider: "google"
      })
      .returning();

    user = newUser;
  }

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
  const expiry = Date.now() + 10 * 60 * 1000; // 10 mins
  await db
    .update(users)
    .set({ resetToken: token, resetTokenExpiry: expiry })
    .where(eq(users.id, user.id));

 const transporter = nodemailer.createTransport({
  host: "smtp-relay.brevo.com",
  port: 587,
  secure: false,
  auth: {
    user: process.env.SMTP_USER, // a39a9a001@smtp-brevo.com
    pass: process.env.SMTP_PASS, // SMTP KEY
  },
});

   await transporter.sendMail({
     from: "GraphCareers <support@graphcareers.com>",
      to: email,
      subject: "Reset Your Password for GraphCareers",
      text: `Hello ${user.name || "User"},\n\nWe received a request to reset your password for your GraphCareers account.\n\nTo reset your password, please click the link below or paste it into your browser:\n\n${process.env.FRONTEND_URL}/reset-password?token=${token}\n\nIf you did not request a password reset, please ignore this email.\n\nThis link will expire in 1 hour for your security.\n\nBest regards,\nThe GraphCareers Team`,
      html: `<p>Hello ${user.name || "User"},</p><p>We received a request to reset your password for your <b>GraphCareers</b> account.</p><p><a href="${process.env.FRONTEND_URL}/reset-password?token=${token}">Click here to reset your password</a></p><p>If you did not request a password reset, please ignore this email.</p><p>This link will expire in 10 minutes for your security.</p><p>Best regards,<br/>The GraphCareers Team</p>`,
    });

  return { success: true };
}

export async function profileService(id){
   const user = await db
    .select({
      id: users.id,
      name: users.name,
      email: users.email,
    })
    .from(users)
    .where(eq(users.id, id))
    .limit(1);

  if (!user.length) {
    return { success: false, error: "User not found" };
  }

  return { success: true, user: user[0] };
}



export async function resetPasswordService(token, password) {
  const now = Date.now();

  const userArr = await db
    .select()
    .from(users)
    .where(
      and(
        eq(users.resetToken, token),
        gt(users.resetTokenExpiry, now)
      )
    )
    .limit(1);

  if (!userArr.length) {
    return {
      success: false,
      error: "Reset link is invalid or has expired.",
    };
  }

  const user = userArr[0];
  const hashedPassword = await bcrypt.hash(password, 12);

  await db
    .update(users)
    .set({
      password: hashedPassword,
      resetToken: null,
      resetTokenExpiry: null,
    })
    .where(eq(users.id, user.id));

  return { success: true };
}