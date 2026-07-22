import { db } from "../db/index.js";
import { resumeEvents } from "../db/schema.js";
import { eq, desc } from "drizzle-orm";
import logger from "../logger/logger.js";

/**
 * Records a workspace event. Append-only audit trail.
 *
 * @param {{ workspaceId, userId, eventType, versionId?, analysisId?, optimizationId?, metadata? }} params
 * @returns {Promise<object>}
 */
export async function recordEvent({ workspaceId, userId, eventType, versionId, analysisId, optimizationId, metadata }) {
  const [event] = await db.insert(resumeEvents).values({
    workspaceId,
    userId,
    eventType,
    versionId: versionId || null,
    analysisId: analysisId || null,
    optimizationId: optimizationId || null,
    metadata: metadata ? JSON.stringify(metadata) : null,
  }).returning();

  logger.info("Workspace event recorded", { workspaceId, eventType, versionId });
  return event;
}

/**
 * Lists recent events for a workspace (paginated, newest first).
 */
export async function listEvents(workspaceId, limit = 20, offset = 0) {
  return db
    .select()
    .from(resumeEvents)
    .where(eq(resumeEvents.workspaceId, workspaceId))
    .orderBy(desc(resumeEvents.createdAt))
    .limit(limit)
    .offset(offset);
}
