import cron from "node-cron";
import { db } from "../db/index.js";
import { users, jobMatches, userJobEmailLog } from "../db/schema.js";
import { jobs as jobsTable } from "../db/schema.js";
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

  // if (!lockValue) {
  //   logger.warn("⚠️ Email worker already running");
  //   return;
  // }

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
      //console.log("Processing batch of users, count:", batchUsers.length);

      if (!batchUsers.length) break;

      for (const user of batchUsers) {
        try {
         // 🔥 Get ONLY unemailed jobs
       
const jobs = await db
  .select({
    jobSourceId: jobMatches.jobSourceId,
    matchPercent: jobMatches.matchPercent,
    matchedSkills: jobMatches.matchedSkills,
    matchedCount: jobMatches.matchedCount,
    requiredCount: jobMatches.requiredCount,

    // 🔥 FROM jobs table
    title: jobsTable.title,
    company: jobsTable.company,
    location: jobsTable.location,
    salaryMin: jobsTable.salaryMin,
    salaryMax: jobsTable.salaryMax,
    sourceUrl: jobsTable.sourceUrl,
  })
  .from(jobMatches)
  .innerJoin(
    jobsTable,
    eq(jobMatches.jobSourceId, jobsTable.sourceJobId)
  )
  .where(
    and(
      eq(jobMatches.userId, user.id),
       eq(jobMatches.isEmailed, false)
    )
  )
  .orderBy(desc(jobMatches.score))
  .limit(2);
  // const jobs = await db
  //           .select()
  //           .from(jobMatches)
  //           .where(
  //             and(
  //               eq(jobMatches.userId, user.id),
  //               eq(jobMatches.isEmailed, false)
  //             )
  //           )
  //           .orderBy(desc(jobMatches.score))
  //           .limit(2);
  //console.log(`User ${user.id} has ${jobs.length} new job matches`);

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
  function getInitials(company = "") {
    return company.split(/\s+/).slice(0, 2).map(w => w[0]?.toUpperCase() || "").join("");
  }

  function formatSalary(min, max) {
    if (!min) return "Salary not disclosed";
    const fmt = (n) => n >= 1000 ? `$${Math.round(n / 1000)}K/yr` : `$${n}/yr`;
    return `${fmt(min)} - ${fmt(max)}`;
  }

  return `<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8"/>
  <meta name="viewport" content="width=device-width, initial-scale=1.0"/>
</head>

<body style="margin:0;padding:0;background:#f0f4f8;font-family:Arial,Helvetica,sans-serif;">

<table width="100%" cellpadding="0" cellspacing="0" style="padding:20px 10px;">
<tr><td align="center">

  <!-- MAIN CONTAINER -->
  <table width="100%" cellpadding="0" cellspacing="0"
    style="max-width:580px;background:#ffffff;border-radius:16px;padding:20px;border:3px solid #22c55e;">

    <!-- HEADER -->
    <tr><td style="padding-bottom:8px;">
      <table cellpadding="0" cellspacing="0">
        <tr>
          <td style="width:28px;height:28px;background:#22c55e;border-radius:7px;text-align:center;">
            <span style="color:#fff;font-size:15px;line-height:28px;">⚡</span>
          </td>
          <td style="padding-left:8px;font-size:18px;font-weight:700;color:#111827;">
            GraphCareers
          </td>
        </tr>
      </table>
    </td></tr>

    <!-- INTRO -->
    <tr><td style="font-size:13px;color:#374151;padding-bottom:16px;line-height:1.6;">
      Explore today’s top matches curated for your skills and experience.
    </td></tr>

    <!-- JOBS -->
    ${jobs.map(job => `
    <tr><td style="padding-bottom:14px;">
      <table width="100%" cellpadding="0" cellspacing="0"
        style="border:1px solid #e5e7eb;border-radius:10px;padding:14px;">

        <!-- TOP ROW -->
        <tr>
          <td width="40" valign="middle">
            <div style="width:40px;height:40px;background:#f3f4f6;border-radius:8px;text-align:center;line-height:40px;font-size:12px;font-weight:700;color:#374151;">
              ${getInitials(job.company)}
            </div>
          </td>

          <td style="padding-left:10px;">
            <div style="font-size:13px;font-weight:700;color:#111827;">
              ${job.company || "Company"}
            </div>
            <div style="font-size:12px;color:#6b7280;margin-top:2px;">
              ${job.location || "Remote"}
            </div>
          </td>

           <td align="right" valign="top" style="padding-left:8px;">
  <table cellpadding="0" cellspacing="0">
    <tr>
      <td style="background:#dcfce7;
                 color:#16a34a;
                 font-size:12px;
                 font-weight:700;
                 padding:4px 10px;
                 border-radius:999px;
                 white-space:nowrap;">
        ${job.matchPercent || 0}%
      </td>
    </tr>
  </table>
</td>
        </tr>

        <!-- TITLE -->
        <tr>
          <td colspan="3" style="padding-top:10px;font-size:16px;font-weight:700;color:#111827;line-height:1.4;">
            ${job.title || "Job Role"}
          </td>
        </tr>

        <!-- TAGS -->
        <tr>
          <td colspan="3" style="padding-top:8px;">
            <div>
              <span style="display:inline-block;background:#f3f4f6;color:#374151;font-size:12px;padding:5px 10px;border-radius:6px;margin-right:6px;margin-bottom:6px;">
                ${formatSalary(job.salaryMin, job.salaryMax)}
              </span>

              <span style="display:inline-block;background:#f3f4f6;color:#374151;font-size:12px;padding:5px 10px;border-radius:6px;margin-bottom:6px;">
                ${job.location || "Remote"}
              </span>
            </div>
          </td>
        </tr>

        <!-- CTA ROW -->
        <tr>
          <td colspan="3" style="padding-top:14px;">
            <table width="100%" cellpadding="0" cellspacing="0">
              <tr>
                <td style="font-size:12px;color:#6b7280;">
                  Be an <b style="color:#111827;">early applicant</b>
                </td>

                <td align="right" style="padding-top:8px;">
  <table cellpadding="0" cellspacing="0">
    <tr>
      <td bgcolor="#22c55e" 
          style="border-radius:999px;
                 padding:0;">
        <a href="${job.sourceUrl || "https://graphcareers.com/jobs"}"
           style="display:inline-block;
                  padding:10px 18px;
                  font-size:13px;
                  font-weight:700;
                  color:#ffffff;
                  text-decoration:none;
                  white-space:nowrap;">
          APPLY NOW
        </a>
      </td>
    </tr>
  </table>
</td>

              </tr>
            </table>
          </td>
        </tr>

      </table>
    </td></tr>
    `).join("")}

    <!-- VIEW MORE -->
    <tr><td style="padding-top:6px;">
      <a href="https://graphcareers.com/jobs"
         style="display:block;text-align:center;background:#000000;color:#ffffff;padding:14px 24px;border-radius:999px;font-size:14px;font-weight:700;text-decoration:none;">
        View More Opportunities
      </a>
    </td></tr>

    <!-- FOOTER -->
    <tr><td style="padding-top:16px;font-size:12px;color:#9ca3af;text-align:center;">
      You're receiving this because you signed up on GraphCareers.
    </td></tr>

  </table>

</td></tr>
</table>

</body>
</html>`;
}




 runEmailWorker()
// ⏰ Run after matcher
// cron.schedule("30 10,17,23 * * *", runEmailWorker, {
//   timezone: "Asia/Kolkata",
// });