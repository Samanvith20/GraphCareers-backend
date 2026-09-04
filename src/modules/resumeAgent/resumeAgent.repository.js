import { and, asc, desc, eq, inArray, lt, sql } from "drizzle-orm";
import { createHash } from "node:crypto";
import { db } from "../../db/index.js";
import {
  jobs,
  resumeAgentEvents,
  resumeAgentMessages,
  resumeAgentRuns,
  resumeAgentTargets,
  resumeChangeProposals,
  resumeCreditReservations,
  resumeFactAssertions,
  resumeEvents,
  resumeVersions,
  resumeWorkspaces,
  resumes,
  users,
} from "../../db/schema.js";
import { AppError } from "../../lib/AppError.js";
import { hydrateResumeContact } from "./domain/resume.js";
import { stableStringify } from "./domain/text.js";

function parseStoredResume(value) {
  if (!value) return {};
  try {
    return typeof value === "string" ? JSON.parse(value) : value;
  } catch {
    return {};
  }
}

function contactFallback(sourceResume, owner) {
  const source = parseStoredResume(sourceResume?.structuredJson);
  return {
    ...(source.contact || {}),
    name: source.contact?.name || source.name || owner?.name,
    email: source.contact?.email || source.email || owner?.email,
    phone: source.contact?.phone || source.phone,
    location: source.contact?.location || source.location || owner?.location,
    linkedin: source.contact?.linkedin || source.linkedin || source.linkedinUrl,
    github: source.contact?.github || source.github || source.githubUrl,
    portfolio: source.contact?.portfolio || source.portfolio,
  };
}

function masterFingerprint(snapshot) {
  return createHash("sha256").update(stableStringify(snapshot)).digest("hex");
}

export async function ensureWorkspace(userId, requestId) {
  return db.transaction(async (tx) => {
    await tx.execute(sql`select id from ${resumes} where ${resumes.userId} = ${userId} for update`);
    const [resume] = await tx.select().from(resumes).where(eq(resumes.userId, userId));
    if (!resume?.structuredJson || resume.status !== "completed") {
      throw new AppError("Upload and successfully parse a resume before using Resume Agent", 422);
    }
    let parsed;
    try {
      parsed = hydrateResumeContact(
        typeof resume.structuredJson === "string" ? JSON.parse(resume.structuredJson) : resume.structuredJson,
        { sourceText: resume.text },
      );
    } catch {
      throw new AppError("The parsed master resume is invalid and must be uploaded again", 422);
    }
    const fingerprint = masterFingerprint(parsed);
    const [existing] = await tx.select().from(resumeWorkspaces).where(
      and(eq(resumeWorkspaces.userId, userId), eq(resumeWorkspaces.resumeId, resume.id)),
    );
    if (existing) {
      const [latestUpload] = await tx.select().from(resumeVersions).where(and(
        eq(resumeVersions.workspaceId, existing.id),
        eq(resumeVersions.source, "upload"),
      )).orderBy(desc(resumeVersions.versionNumber)).limit(1);
      let latestFingerprint = null;
      if (latestUpload) {
        try {
          latestFingerprint = masterFingerprint(JSON.parse(latestUpload.snapshotJson));
        } catch {
          latestFingerprint = null;
        }
      }
      if (latestFingerprint === fingerprint) return existing;

      const [latest] = await tx
        .select({ maxVersion: sql`coalesce(max(${resumeVersions.versionNumber}), 0)` })
        .from(resumeVersions)
        .where(eq(resumeVersions.workspaceId, existing.id));
      const [version] = await tx.insert(resumeVersions).values({
        workspaceId: existing.id,
        versionNumber: Number(latest.maxVersion) + 1,
        snapshotJson: JSON.stringify(parsed),
        source: "upload",
        sourceMetadata: JSON.stringify({ resumeId: resume.id, masterFingerprint: fingerprint }),
        parentVersionId: existing.activeVersionId,
        changeSummary: "Master resume refreshed from the latest uploaded resume",
      }).returning();
      const [ready] = await tx.update(resumeWorkspaces).set({
        activeVersionId: version.id,
        totalVersions: sql`${resumeWorkspaces.totalVersions} + 1`,
        status: "ready",
        updatedAt: new Date(),
      }).where(eq(resumeWorkspaces.id, existing.id)).returning();
      await tx.insert(resumeEvents).values({
        workspaceId: existing.id,
        userId,
        eventType: "version_created",
        versionId: version.id,
        metadata: JSON.stringify({ versionNumber: version.versionNumber, source: "upload", refreshed: true }),
      });
      return ready;
    }

    const [workspace] = await tx.insert(resumeWorkspaces).values({ userId, resumeId: resume.id, status: "idle" }).returning();
    const [version] = await tx.insert(resumeVersions).values({
      workspaceId: workspace.id,
      versionNumber: 1,
      snapshotJson: JSON.stringify(parsed),
      source: "upload",
      sourceMetadata: JSON.stringify({ resumeId: resume.id, masterFingerprint: fingerprint }),
      changeSummary: "Initial version created from the parsed master resume",
    }).returning();
    const [ready] = await tx.update(resumeWorkspaces).set({
      activeVersionId: version.id,
      totalVersions: 1,
      status: "ready",
      updatedAt: new Date(),
    }).where(eq(resumeWorkspaces.id, workspace.id)).returning();
    await tx.insert(resumeEvents).values([
      { workspaceId: workspace.id, userId, eventType: "workspace_created", versionId: version.id, metadata: JSON.stringify({ requestId, resumeId: resume.id }) },
      { workspaceId: workspace.id, userId, eventType: "version_created", versionId: version.id, metadata: JSON.stringify({ versionNumber: 1, source: "upload" }) },
    ]);
    return ready;
  });
}

export async function getJobBySourceId(jobSourceId) {
  const [job] = await db.select().from(jobs).where(eq(jobs.sourceJobId, jobSourceId)).limit(1);
  return job || null;
}

export async function createTarget(values) {
  const [target] = await db.insert(resumeAgentTargets).values(values).returning();
  return target;
}

export async function requireTarget(userId, targetId) {
  const [target] = await db.select().from(resumeAgentTargets).where(
    and(eq(resumeAgentTargets.id, targetId), eq(resumeAgentTargets.userId, userId)),
  );
  if (!target) throw new AppError("Resume target not found", 404);
  return target;
}

export async function requireVersion(userId, versionId) {
  const [row] = await db
    .select({
      version: resumeVersions,
      workspace: resumeWorkspaces,
      sourceResume: resumes,
      owner: { name: users.name, email: users.email, location: users.location },
    })
    .from(resumeVersions)
    .innerJoin(resumeWorkspaces, eq(resumeVersions.workspaceId, resumeWorkspaces.id))
    .innerJoin(resumes, eq(resumeWorkspaces.resumeId, resumes.id))
    .innerJoin(users, eq(resumeWorkspaces.userId, users.id))
    .where(and(eq(resumeVersions.id, versionId), eq(resumeWorkspaces.userId, userId)));
  if (!row) throw new AppError("Resume version not found", 404);
  let snapshot;
  try {
    snapshot = typeof row.version.snapshotJson === "string"
      ? JSON.parse(row.version.snapshotJson)
      : row.version.snapshotJson;
    if (!snapshot || typeof snapshot !== "object" || Array.isArray(snapshot)) throw new TypeError("Invalid snapshot");
  } catch {
    throw new AppError("Resume version contains invalid data", 422);
  }
  const hydrated = hydrateResumeContact(snapshot, {
    sourceText: row.sourceResume.text,
    fallbackContact: contactFallback(row.sourceResume, row.owner),
  });
  return {
    version: { ...row.version, snapshotJson: JSON.stringify(hydrated) },
    workspace: row.workspace,
    sourceResumeText: row.sourceResume.text || "",
  };
}

export async function requireWorkspace(userId, workspaceId) {
  const [workspace] = await db.select().from(resumeWorkspaces).where(
    and(eq(resumeWorkspaces.id, workspaceId), eq(resumeWorkspaces.userId, userId)),
  );
  if (!workspace) throw new AppError("Resume workspace not found", 404);
  return workspace;
}

export async function requireLatestMasterVersion(userId, workspaceId) {
  await requireWorkspace(userId, workspaceId);
  const [version] = await db.select().from(resumeVersions).where(and(
    eq(resumeVersions.workspaceId, workspaceId),
    eq(resumeVersions.source, "upload"),
  )).orderBy(desc(resumeVersions.versionNumber)).limit(1);
  if (!version) throw new AppError("No master resume version is available", 422);
  return version;
}

export async function getWorkspaceOverview(userId, requestId) {
  const workspace = await ensureWorkspace(userId, requestId);
  const versions = await db.select({
    id: resumeVersions.id,
    versionNumber: resumeVersions.versionNumber,
    source: resumeVersions.source,
    sourceMetadata: resumeVersions.sourceMetadata,
    parentVersionId: resumeVersions.parentVersionId,
    changeSummary: resumeVersions.changeSummary,
    createdAt: resumeVersions.createdAt,
  }).from(resumeVersions).where(eq(resumeVersions.workspaceId, workspace.id)).orderBy(desc(resumeVersions.versionNumber));
  return { workspace, versions };
}

export async function createRunWithReservation({ userId, workspaceId, targetId, baseVersionId, mode, idempotencyKey, creditCost }) {
  const existing = await db.select().from(resumeAgentRuns).where(
    and(eq(resumeAgentRuns.userId, userId), eq(resumeAgentRuns.idempotencyKey, idempotencyKey)),
  ).limit(1);
  if (existing[0]) {
    if (existing[0].targetId !== targetId || existing[0].baseVersionId !== baseVersionId || existing[0].mode !== mode) {
      throw new AppError("That idempotency key was already used for a different resume run", 409);
    }
    return { run: existing[0], created: false };
  }

  try {
    return await db.transaction(async (tx) => {
      await tx.execute(sql`select id from ${users} where ${users.id} = ${userId} for update`);
      const [user] = await tx.select().from(users).where(eq(users.id, userId));
      if (!user) throw new AppError("User not found", 404);

      const [reserved] = await tx
        .select({ total: sql`coalesce(sum(${resumeCreditReservations.amount}), 0)` })
        .from(resumeCreditReservations)
        .where(and(eq(resumeCreditReservations.userId, userId), eq(resumeCreditReservations.status, "reserved")));
      const available = Number(user.credits || 0) - Number(reserved?.total || 0);
      if (creditCost > available) throw new AppError("Insufficient credits for this resume operation", 402);

      const [run] = await tx.insert(resumeAgentRuns).values({
        userId,
        workspaceId,
        targetId,
        baseVersionId,
        mode,
        idempotencyKey,
      }).returning();
      if (creditCost > 0) {
        await tx.insert(resumeCreditReservations).values({ runId: run.id, userId, amount: creditCost });
      }
      await tx.insert(resumeAgentEvents).values({ runId: run.id, userId, eventType: "run_created", payloadJson: { mode, creditCost } });
      return { run, created: true };
    });
  } catch (error) {
    if (error?.code !== "23505") throw error;
    const [replayed] = await db.select().from(resumeAgentRuns).where(
      and(eq(resumeAgentRuns.userId, userId), eq(resumeAgentRuns.idempotencyKey, idempotencyKey)),
    ).limit(1);
    if (!replayed || replayed.targetId !== targetId || replayed.baseVersionId !== baseVersionId || replayed.mode !== mode) {
      throw new AppError("That idempotency key was already used for a different resume run", 409);
    }
    return { run: replayed, created: false };
  }
}

export async function requireRun(userId, runId) {
  const [run] = await db.select().from(resumeAgentRuns).where(
    and(eq(resumeAgentRuns.id, runId), eq(resumeAgentRuns.userId, userId)),
  );
  if (!run) throw new AppError("Resume agent run not found", 404);
  return run;
}

export async function getRunContext(userId, runId) {
  const run = await requireRun(userId, runId);
  const [target, version, assertions, proposals] = await Promise.all([
    requireTarget(userId, run.targetId),
    requireVersion(userId, run.outputVersionId || run.baseVersionId),
    db.select().from(resumeFactAssertions).where(and(
      eq(resumeFactAssertions.userId, userId),
      eq(resumeFactAssertions.workspaceId, run.workspaceId),
      eq(resumeFactAssertions.status, "verified"),
    )),
    db.select().from(resumeChangeProposals).where(and(
      eq(resumeChangeProposals.userId, userId),
      eq(resumeChangeProposals.runId, runId),
    )).orderBy(asc(resumeChangeProposals.createdAt)),
  ]);
  return {
    run,
    target,
    version: version.version,
    workspace: version.workspace,
    assertions,
    proposals,
    sourceEvidenceText: version.sourceResumeText,
  };
}

export async function updateRun(runId, values) {
  const [run] = await db.update(resumeAgentRuns).set({ ...values, updatedAt: new Date() }).where(eq(resumeAgentRuns.id, runId)).returning();
  return run;
}

export async function recordAgentEvent({ runId, userId, eventType, payloadJson }) {
  const [event] = await db.insert(resumeAgentEvents).values({ runId, userId, eventType, payloadJson }).returning();
  return event;
}

export async function insertProposals(values) {
  if (!values.length) return [];
  return db.insert(resumeChangeProposals).values(values).returning();
}

export async function clearRetryableProposals(runId) {
  await db.delete(resumeChangeProposals).where(and(
    eq(resumeChangeProposals.runId, runId),
    inArray(resumeChangeProposals.status, ["proposed", "approved", "blocked"]),
  ));
}

export async function requireProposal(userId, proposalId) {
  const [proposal] = await db.select().from(resumeChangeProposals).where(
    and(eq(resumeChangeProposals.id, proposalId), eq(resumeChangeProposals.userId, userId)),
  );
  if (!proposal) throw new AppError("Resume change proposal not found", 404);
  return proposal;
}

export async function updateProposal(proposalId, values) {
  const [proposal] = await db.update(resumeChangeProposals).set(values).where(eq(resumeChangeProposals.id, proposalId)).returning();
  return proposal;
}

export async function insertFact(values) {
  const [fact] = await db.insert(resumeFactAssertions).values(values).returning();
  return fact;
}

export async function insertMessage(values) {
  if (values.clientMessageId) {
    const [existing] = await db.select().from(resumeAgentMessages).where(and(
      eq(resumeAgentMessages.runId, values.runId),
      eq(resumeAgentMessages.clientMessageId, values.clientMessageId),
    ));
    if (existing) return { message: existing, created: false };
  }
  const [message] = await db.insert(resumeAgentMessages).values(values).returning();
  return { message, created: true };
}

export async function listMessages(userId, runId, { limit, before }) {
  await requireRun(userId, runId);
  const conditions = [eq(resumeAgentMessages.runId, runId), eq(resumeAgentMessages.userId, userId)];
  if (before) conditions.push(lt(resumeAgentMessages.createdAt, new Date(before)));
  const rows = await db.select().from(resumeAgentMessages).where(and(...conditions)).orderBy(desc(resumeAgentMessages.createdAt)).limit(limit);
  return rows.reverse();
}

export async function releaseReservation(runId) {
  await db.update(resumeCreditReservations).set({ status: "released", settledAt: new Date() }).where(
    and(eq(resumeCreditReservations.runId, runId), eq(resumeCreditReservations.status, "reserved")),
  );
}

export async function reserveCreditsForExistingRun(runId, userId, amount) {
  if (amount <= 0) return null;
  return db.transaction(async (tx) => {
    await tx.execute(sql`select id from ${users} where ${users.id} = ${userId} for update`);
    const [user] = await tx.select().from(users).where(eq(users.id, userId));
    if (!user) throw new AppError("User not found", 404);
    const [reserved] = await tx
      .select({ total: sql`coalesce(sum(${resumeCreditReservations.amount}), 0)` })
      .from(resumeCreditReservations)
      .where(and(eq(resumeCreditReservations.userId, userId), eq(resumeCreditReservations.status, "reserved")));
    if (Number(user.credits || 0) - Number(reserved?.total || 0) < amount) {
      throw new AppError("Insufficient credits for this resume operation", 402);
    }
    const [current] = await tx.select().from(resumeCreditReservations).where(eq(resumeCreditReservations.runId, runId));
    if (current) {
      if (current.status === "reserved") {
        throw new AppError("Another resume change is already being applied for this run", 409);
      }
      const [updated] = await tx.update(resumeCreditReservations).set({ amount, status: "reserved", settledAt: null }).where(eq(resumeCreditReservations.id, current.id)).returning();
      return updated;
    }
    const [created] = await tx.insert(resumeCreditReservations).values({ runId, userId, amount }).returning();
    return created;
  });
}

export async function finalizeRunWithVersion({ run, resume, scoreAfter, source, changeSummary, resultJson, proposalIds = [] }) {
  return db.transaction(async (tx) => {
    await tx.execute(sql`select id from ${resumeWorkspaces} where ${resumeWorkspaces.id} = ${run.workspaceId} for update`);
    const [latest] = await tx
      .select({ maxVersion: sql`coalesce(max(${resumeVersions.versionNumber}), 0)` })
      .from(resumeVersions)
      .where(eq(resumeVersions.workspaceId, run.workspaceId));
    const [version] = await tx.insert(resumeVersions).values({
      workspaceId: run.workspaceId,
      versionNumber: Number(latest.maxVersion) + 1,
      snapshotJson: JSON.stringify(resume),
      source,
      sourceMetadata: JSON.stringify({ resumeAgentRunId: run.id, targetId: run.targetId }),
      parentVersionId: run.outputVersionId || run.baseVersionId,
      changeSummary,
    }).returning();

    await tx.update(resumeWorkspaces).set({
      activeVersionId: version.id,
      totalVersions: sql`${resumeWorkspaces.totalVersions} + 1`,
      totalOptimizations: sql`${resumeWorkspaces.totalOptimizations} + 1`,
      status: "ready",
      updatedAt: new Date(),
    }).where(eq(resumeWorkspaces.id, run.workspaceId));

    const [reservation] = await tx.select().from(resumeCreditReservations).where(
      and(eq(resumeCreditReservations.runId, run.id), eq(resumeCreditReservations.status, "reserved")),
    );
    if (reservation?.amount > 0) {
      const [debitedUser] = await tx
        .update(users)
        .set({ credits: sql`${users.credits} - ${reservation.amount}` })
        .where(and(eq(users.id, run.userId), sql`${users.credits} >= ${reservation.amount}`))
        .returning({ id: users.id });
      if (!debitedUser) throw new AppError("Credits changed while the resume was processing", 409);
      await tx.update(resumeCreditReservations).set({ status: "consumed", settledAt: new Date() }).where(eq(resumeCreditReservations.id, reservation.id));
    }

    if (proposalIds.length) {
      await tx.update(resumeChangeProposals).set({ status: "applied", appliedAt: new Date() }).where(
        inArray(resumeChangeProposals.id, proposalIds),
      );
    }
    const [completedRun] = await tx.update(resumeAgentRuns).set({
      outputVersionId: version.id,
      scoreAfterJson: scoreAfter,
      resultJson,
      status: "completed",
      completedAt: new Date(),
      updatedAt: new Date(),
    }).where(eq(resumeAgentRuns.id, run.id)).returning();
    await tx.insert(resumeAgentEvents).values({
      runId: run.id,
      userId: run.userId,
      eventType: "version_created",
      payloadJson: { versionId: version.id, versionNumber: version.versionNumber },
    });
    return { run: completedRun, version };
  });
}

export async function listRunEvents(userId, runId) {
  await requireRun(userId, runId);
  return db.select().from(resumeAgentEvents).where(and(
    eq(resumeAgentEvents.runId, runId),
    eq(resumeAgentEvents.userId, userId),
  )).orderBy(asc(resumeAgentEvents.createdAt));
}
