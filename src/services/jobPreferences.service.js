import { eq, sql } from "drizzle-orm";
import { db } from "../db/index.js";
import { userJobPreferences } from "../db/schema.js";
import { emptyJobPreferences } from "../schemas/jobPreferences.schema.js";
import { AppError } from "../lib/AppError.js";
import logger from "../logger/logger.js";

function isMissingTable(error) {
  return error?.code === "42P01" || error?.cause?.code === "42P01";
}

export async function getJobPreferences(userId) {
  try {
    const [row] = await db.select().from(userJobPreferences).where(eq(userJobPreferences.userId, userId));
    return { ...emptyJobPreferences, ...row?.preferences };
  } catch (error) {
    // Rolling deployment: keep the existing feed usable before the additive migration.
    if (!isMissingTable(error)) throw error;
    logger.warn("Job preferences migration is pending; using unanswered preferences");
    return { ...emptyJobPreferences };
  }
}

export async function saveJobPreferences(userId, patch) {
  try {
  const [row] = await db.insert(userJobPreferences).values({ userId, preferences: patch })
    .onConflictDoUpdate({
      target: userJobPreferences.userId,
      // Merge inside Postgres to avoid lost updates from concurrent partial saves.
      set: { preferences: sql`${userJobPreferences.preferences} || ${JSON.stringify(patch)}::jsonb`, updatedAt: new Date() },
    }).returning();
  return { ...emptyJobPreferences, ...row.preferences };
  } catch (error) {
    if (isMissingTable(error)) throw new AppError("Job preferences are not available yet. Please try again later; you can still browse jobs.", 503);
    throw error;
  }
}
