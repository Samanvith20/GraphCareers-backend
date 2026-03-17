import { db } from "../db/index.js";
import { userJobApplications } from "../db/schema.js";
import { and, eq, desc } from "drizzle-orm";

/**
 * Create or update a tracked job for a user
 */
export const upsertJobApplicationService = async ({
  userId,
  jobUrl,
  jobTitle,
  company,
  source,
  status,
  notes,
}) => {
  // 🔍 check if job already tracked
  const existing =
    await db.query.userJobApplications.findFirst({
      where: (t) =>
        and(eq(t.userId, userId), eq(t.jobUrl, jobUrl)),
    });

  if (existing) {
    await db
      .update(userJobApplications)
      .set({
        status,
        notes,
        statusUpdatedAt: new Date(),
      })
      .where(eq(userJobApplications.id, existing.id));

     return { type: "updated" };
  }

  await db.insert(userJobApplications).values({
    userId,
    jobUrl,
    jobTitle,
    company,
    source,
    status,
    notes,
  });

   return { type: "created" };
};

/**
 * Fetch all tracked jobs for a user
 */
export const getUserJobApplicationsService = async (
  userId
) => {
  return db.query.userJobApplications.findMany({
    where: (t) => eq(t.userId, userId),
    orderBy: (t) => [desc(t.statusUpdatedAt)],
  });
};