import { db } from "../db/index.js";
import { users } from "../db/schema.js";
import bcrypt from "bcrypt";
import nodemailer from "nodemailer";
import { randomUUID } from "crypto";
import { and, eq, gt } from "drizzle-orm";
import { OAuth2Client } from "google-auth-library";
import { AppError } from "../lib/AppError.js";



const client = new OAuth2Client(process.env.GOOGLE_CLIENT_ID);

export async function loginService(email, password) {
  const emailLc = email.trim().toLowerCase();

  const user = await db
    .select()
    .from(users)
    .where(eq(users.email, emailLc))
    .limit(1);

  if (!user.length) {
    throw new AppError("User not found", 404);
  }

  if (!user[0].password) {
    throw new AppError("It looks like you previously signed up with Google. Please continue with Google to log in, or reset your password.", 401);
  }

  const match = await bcrypt.compare(password, user[0].password);
  if (!match) {
    throw new AppError("Invalid credentials", 401);
  }
return {
  id: user[0].id,
  name: user[0].name,
  email: user[0].email,
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
   throw new AppError("User already exists", 409);
  }

  const hash = await bcrypt.hash(password, 10);

  const [user] = await db
    .insert(users)
    .values({ name, email: emailLc, password: hash })
    .returning();

  return {
  
      id: user.id,
      name: user.name,
      email: user.email,
    }
  };




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
    
      id: user.id,
      name: user.name,
      email: user.email,
    
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
    throw new AppError("User not found", 404);
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

  return true;
}

export async function profileService(id){
   const user = await db
    .select({
      id: users.id,
      name: users.name,
      email: users.email,
      credits: users.credits,
    })
    .from(users)
    .where(eq(users.id, id))
    .limit(1);

  if (!user.length) {
    throw new AppError("User not found", 404);
  }

  return user[0];
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
    throw new AppError("Invalid or expired token", 400);
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

  return true;
}