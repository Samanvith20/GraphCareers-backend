import nodemailer from "nodemailer";
import logger from "../logger/logger.js";

const transporter = nodemailer.createTransport({
  host: "smtp-relay.brevo.com",
  port: 587,
  secure: false,
  auth: {
    user: process.env.SMTP_USER, // a39a9a001@smtp-brevo.com
    pass: process.env.SMTP_PASS, // SMTP KEY
  },
});

export async function sendEmail({ to, subject, html }) {
  try {
    const info = await transporter.sendMail({
  from: "GraphCareers <support@graphcareers.com>",
  to,
  subject,
  text: "We found new job matches for your profile. Visit GraphCareers to view them.",
  html,
});

    logger.info(`📧 Email sent to ${to}`, {
      messageId: info.messageId,
    });
    //console.log("info::",info)

    return info;
  } catch (error) {
    logger.error("❌ Email sending failed", error);
    throw error;
  }
}