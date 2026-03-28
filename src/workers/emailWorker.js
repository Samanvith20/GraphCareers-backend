import cron from "node-cron";
import { db } from "../db/index.js";
import { users, jobMatches, userJobEmailLog } from "../db/schema.js";
import { eq, desc, and } from "drizzle-orm";
import logger from "../logger/logger.js";
import redis from "../config/redis.js";
import crypto from "crypto";
import { sendEmail } from "../lib/sendEmail.js";


const BATCH_SIZE = 50;

// 🔒 Lock
async function acquireLock(key, ttl = 60 * 60) {
  const value = crypto.randomUUID();
  const result = await redis.set(key, value, "NX", "EX", ttl);
  return result === "OK" ? value : null;
}

async function releaseLock(key, value) {
  const current = await redis.get(key);
  if (current === value) await redis.del(key);
}

async function runEmailWorker() {
  const lockKey = "lock:email";
  const lockValue = await acquireLock(lockKey, 7200);

  if (!lockValue) {
    logger.warn("⚠️ Email worker already running");
    return;
  }

  logger.info("📧 Email Worker Started");

  let lastId = null;

  try {
    while (true) {
      const batchUsers = await db.query.users.findMany({
        columns: { id: true, email: true, name: true },
        limit: BATCH_SIZE,
        ...(lastId && { where: (u, { gt }) => gt(u.id, lastId) }),
        orderBy: (u, { asc }) => [asc(u.id)],
      });

      if (!batchUsers.length) break;

      for (const user of batchUsers) {
        try {
          // 🔥 Get ONLY unemailed jobs
          const jobs = await db
            .select()
            .from(jobMatches)
            .where(
              and(
                eq(jobMatches.userId, user.id),
                eq(jobMatches.isEmailed, false)
              )
            )
            .orderBy(desc(jobMatches.score))
            .limit(2);
            console.log("jobs",jobs)

          if (!jobs.length) continue;

          const topJobs = jobs.slice(0, 2);

          // 📩 Send email
          await sendEmail({
            to: user.email,
            subject: `${jobs.length} new job matches for your profile`,
            html: generateEmailHTML(user.name, topJobs),
          });

          // 🧠 Mark as emailed
          await db.transaction(async (tx) => {
            for (const job of jobs) {
              await tx
                .update(jobMatches)
                .set({ isEmailed: true })
                .where(
                  and(
                    eq(jobMatches.userId, user.id),
                    eq(jobMatches.jobSourceId, job.jobSourceId)
                  )
                );

              await tx.insert(userJobEmailLog).values({
                userId: user.id,
                jobSourceId: job.jobSourceId,
              });
            }

            await tx
              .update(users)
              .set({ lastEmailSentAt: new Date() })
              .where(eq(users.id, user.id));
          });

        } catch (err) {
          logger.error(`Email failed for user ${user.id}`, err);
        }
      }

      lastId = batchUsers[batchUsers.length - 1].id;
    }

    logger.info("✅ Email Worker Completed");
  } finally {
    await releaseLock(lockKey, lockValue);
  }
}

function generateEmailHTML(name, jobs) {
  return `
  <!DOCTYPE html>
  <html>
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0"/>
    <title>New Job Matches</title>
  </head>
  <body style="margin:0;padding:0;background-color:#f0f4f8;font-family:'Segoe UI',Helvetica,Arial,sans-serif;">

    <table width="100%" cellpadding="0" cellspacing="0" style="background:#f0f4f8;padding:40px 0;">
      <tr>
        <td align="center">
          <table width="600" cellpadding="0" cellspacing="0" style="max-width:600px;width:100%;">

            <!-- HEADER -->
            <tr>
              <td style="background:#0f172a;border-radius:12px 12px 0 0;padding:32px 36px;">
                <table width="100%" cellpadding="0" cellspacing="0">
                  <tr>
                    <td>
                      <div style="font-size:20px;font-weight:700;color:#ffffff;letter-spacing:-0.3px;">GraphCareers</div>
                      <div style="font-size:12px;color:#94a3b8;margin-top:4px;letter-spacing:0.5px;text-transform:uppercase;">Job Match Report</div>
                    </td>
                    <td align="right">
                      <div style="background:#1e3a5f;border:1px solid #2d5a8e;border-radius:20px;padding:6px 14px;display:inline-block;">
                        <span style="font-size:12px;color:#60a5fa;font-weight:600;">${jobs.length} New Match${jobs.length > 1 ? 'es' : ''}</span>
                      </div>
                    </td>
                  </tr>
                </table>
              </td>
            </tr>

            <!-- BODY -->
            <tr>
              <td style="background:#ffffff;padding:32px 36px;">

                <!-- Greeting -->
                <p style="margin:0 0 6px;font-size:22px;font-weight:700;color:#0f172a;">Hello, ${name || 'there'} 👋</p>
                <p style="margin:0 0 28px;font-size:15px;color:#64748b;line-height:1.6;">
                  Great news — we found <strong style="color:#0f172a;">${jobs.length} new job${jobs.length > 1 ? 's' : ''}</strong> that match your profile. Here's what we found for you:
                </p>

                <!-- Job Cards -->
                ${jobs.map((job, i) => `
                <table width="100%" cellpadding="0" cellspacing="0" style="margin-bottom:16px;border:1.5px solid #e2e8f0;border-radius:10px;overflow:hidden;">
                  <tr>
                    <td style="padding:20px 24px;">
                      
                      <!-- Job Header -->
                      <table width="100%" cellpadding="0" cellspacing="0" style="margin-bottom:12px;">
                        <tr>
                          <td>
                            <div style="font-size:11px;font-weight:600;color:#64748b;letter-spacing:0.8px;text-transform:uppercase;margin-bottom:4px;">Job ID #${job.jobSourceId}</div>
                            <div style="font-size:18px;font-weight:700;color:#0f172a;">Job Opportunity ${i + 1}</div>
                          </td>
                          <td align="right" valign="top">
                            <div style="background:#dcfce7;border-radius:20px;padding:6px 14px;display:inline-block;">
                              <span style="font-size:13px;font-weight:700;color:#15803d;">${job.matchPercent}% Match</span>
                            </div>
                          </td>
                        </tr>
                      </table>

                      <!-- Divider -->
                      <div style="height:1px;background:#f1f5f9;margin-bottom:14px;"></div>

                      <!-- Skills -->
                      ${job.matchedSkills && job.matchedSkills.length ? `
                      <div style="margin-bottom:16px;">
                        <div style="font-size:11px;font-weight:600;color:#94a3b8;letter-spacing:0.6px;text-transform:uppercase;margin-bottom:8px;">Matched Skills</div>
                        <div>
                          ${job.matchedSkills.map(skill => `
                            <span style="display:inline-block;background:#eff6ff;color:#1d4ed8;font-size:12px;font-weight:600;padding:4px 10px;border-radius:20px;margin:0 4px 6px 0;border:1px solid #bfdbfe;">${skill}</span>
                          `).join('')}
                        </div>
                      </div>` : ''}

                      <!-- Stats Row -->
                      <table width="100%" cellpadding="0" cellspacing="0" style="background:#f8fafc;border-radius:8px;margin-bottom:18px;">
                        <tr>
                          <td style="padding:12px 16px;text-align:center;border-right:1px solid #e2e8f0;">
                            <div style="font-size:20px;font-weight:700;color:#0f172a;">${job.matchedCount}/${job.requiredCount}</div>
                            <div style="font-size:11px;color:#94a3b8;margin-top:2px;text-transform:uppercase;letter-spacing:0.5px;">Skills Matched</div>
                          </td>
                          <td style="padding:12px 16px;text-align:center;border-right:1px solid #e2e8f0;">
                            <div style="font-size:20px;font-weight:700;color:#15803d;">${job.matchPercent}%</div>
                            <div style="font-size:11px;color:#94a3b8;margin-top:2px;text-transform:uppercase;letter-spacing:0.5px;">Match Rate</div>
                          </td>
                        
                        </tr>
                      </table>

                      <!-- CTA Button -->
                      <a href="https://graphcareers.com/jobs"
                         style="display:block;text-align:center;background:#0f172a;color:#ffffff;text-decoration:none;padding:13px 24px;border-radius:8px;font-size:14px;font-weight:600;letter-spacing:0.3px;">
                        View This Job &rarr;
                      </a>

                    </td>
                  </tr>
                </table>
                `).join('')}

                <!-- View All CTA -->
                <table width="100%" cellpadding="0" cellspacing="0" style="margin-top:8px;">
                  <tr>
                    <td align="center">
                      <a href="https://graphcareers.com/jobs"
                         style="display:inline-block;background:#2563eb;color:#ffffff;text-decoration:none;padding:14px 36px;border-radius:8px;font-size:15px;font-weight:700;letter-spacing:0.2px;">
                        View All Matches on GraphCareers
                      </a>
                    </td>
                  </tr>
                </table>

              </td>
            </tr>

            <!-- FOOTER -->
            <tr>
              <td style="background:#f8fafc;border-top:1px solid #e2e8f0;border-radius:0 0 12px 12px;padding:24px 36px;">
                <table width="100%" cellpadding="0" cellspacing="0">
                  <tr>
                    <td>
                      <p style="margin:0;font-size:12px;color:#94a3b8;line-height:1.6;">
                        You're receiving this because you signed up at <a href="https://graphcareers.com" style="color:#2563eb;text-decoration:none;">GraphCareers</a>.
                        <br/>To update preferences, visit your <a href="https://graphcareers.com/settings" style="color:#2563eb;text-decoration:none;">account settings</a>.
                      </p>
                    </td>
                    <td align="right">
                      <div style="font-size:12px;font-weight:700;color:#cbd5e1;">GraphCareers</div>
                    </td>
                  </tr>
                </table>
              </td>
            </tr>

          </table>
        </td>
      </tr>
    </table>

  </body>
  </html>
  `;
}

// runEmailWorker()
// ⏰ Run after matcher
cron.schedule("30 10,17,23 * * *", runEmailWorker, {
  timezone: "Asia/Kolkata",
});