import { AppError } from "../../lib/AppError.js";
import logger from "../../logger/logger.js";
import { applyResumePatches, readPointer } from "./domain/patches.js";
import { buildVerifiedFacts, validateProposedChange } from "./domain/factGuard.js";
import { defaultSkillPath, parseResumeSnapshot } from "./domain/resume.js";
import { scoreResumeForTarget } from "./domain/scoring.js";
import { normalizeTerm, uniqueTerms } from "./domain/text.js";
import { canCreateResumeVersion } from "./domain/versionPolicy.js";
import { isRetryableModelError, resumeAgentModelGateway } from "./resumeAgent.modelGateway.js";
import {
  createRunWithReservation,
  clearRetryableProposals,
  finalizeRunWithVersion,
  getRunContext,
  insertFact,
  insertProposals,
  recordAgentEvent,
  reserveCreditsForExistingRun,
  releaseReservation,
  requireRun,
  requireLatestMasterVersion,
  requireTarget,
  requireVersion,
  updateRun,
} from "./resumeAgent.repository.js";
import { enqueueResumeAgentRun } from "./resumeAgent.queue.js";

const CREDIT_COST = { platform_market: 2, career_job: 3, manual_jd: 3 };
export const FOLLOWUP_EDIT_CREDIT_COST = 1;

function publicRunFailure(error) {
  if (error?.name === "AbortError") {
    return { code: "MODEL_TIMEOUT", message: "Resume generation timed out while waiting for the AI provider." };
  }
  const statusCode = Number(error?.statusCode);
  if (statusCode === 401 || statusCode === 403) {
    return { code: "MODEL_AUTH_ERROR", message: "Resume generation is temporarily unavailable because the AI provider credentials were rejected." };
  }
  if (statusCode === 402) {
    return { code: "MODEL_BILLING_ERROR", message: "Resume generation is temporarily unavailable because the AI provider account requires attention." };
  }
  if (statusCode === 429) {
    return { code: "MODEL_RATE_LIMITED", message: "The AI provider is busy right now. Please check this run again shortly." };
  }
  if (Number.isFinite(statusCode) && statusCode >= 500) {
    return { code: "MODEL_UNAVAILABLE", message: "The AI provider is temporarily unavailable. Please try again later." };
  }
  if (error?.name === "AI_APICallError") {
    return { code: "MODEL_PROVIDER_ERROR", message: "The AI provider could not complete this resume. Please try again later." };
  }
  return { code: "RUN_FAILED", message: "Resume generation failed unexpectedly. Please try again later." };
}

function publicRun(run) {
  return {
    id: run.id,
    targetId: run.targetId,
    baseVersionId: run.baseVersionId,
    outputVersionId: run.outputVersionId,
    mode: run.mode,
    status: run.status,
    scoreBefore: run.scoreBeforeJson,
    scoreAfter: run.scoreAfterJson,
    result: run.resultJson,
    error: run.errorMessage ? { code: run.errorCode, message: run.errorMessage } : null,
    createdAt: run.createdAt,
    updatedAt: run.updatedAt,
    completedAt: run.completedAt,
  };
}

export async function createAgentRun(userId, input, requestId) {
  const target = await requireTarget(userId, input.targetId);
  const workspaceId = target.workspaceId;
  let baseVersionId = input.baseVersionId;
  if (baseVersionId) {
    const { workspace } = await requireVersion(userId, baseVersionId);
    if (workspace.id !== workspaceId) throw new AppError("Base version belongs to another resume workspace", 409);
  } else {
    const masterVersion = await requireLatestMasterVersion(userId, workspaceId);
    baseVersionId = masterVersion.id;
  }
  if (!baseVersionId) throw new AppError("No active resume version is available", 422);
  const creditCost = input.mode === "analyze" ? 0 : CREDIT_COST[target.type];
  const { run, created } = await createRunWithReservation({
    userId,
    workspaceId,
    targetId: target.id,
    baseVersionId,
    mode: input.mode,
    idempotencyKey: input.idempotencyKey,
    creditCost,
  });
  if (created) {
    try {
      await enqueueResumeAgentRun({ runId: run.id, userId, requestId });
    } catch (error) {
      await releaseReservation(run.id);
      await updateRun(run.id, {
        status: "failed",
        errorCode: "QUEUE_UNAVAILABLE",
        errorMessage: "Resume processing is temporarily unavailable",
        completedAt: new Date(),
      });
      await recordAgentEvent({ runId: run.id, userId, eventType: "run_failed", payloadJson: { code: "QUEUE_UNAVAILABLE" } });
      logger.error("Unable to enqueue resume agent run", { requestId, userId, runId: run.id, error: error.message });
      throw new AppError("Resume processing is temporarily unavailable", 503);
    }
  }
  return { ...publicRun(run), idempotentReplay: !created };
}

function proposalsFromModel({ modelResult, resume, target, assertions, sourceEvidenceText, run, userId, autoApprove = true }) {
  const verifiedFacts = buildVerifiedFacts(resume, assertions, sourceEvidenceText);
  const proposals = [];
  for (const candidate of modelResult.proposals || []) {
    let beforeValue;
    try {
      beforeValue = readPointer(resume, candidate.targetPath);
      if (beforeValue === undefined) continue;
    } catch {
      continue;
    }
    const validation = validateProposedChange({
      beforeValue,
      afterValue: candidate.afterValue,
      target,
      verifiedFacts,
      claimedSkills: candidate.claimedSkills,
    });
    proposals.push({
      runId: run.id,
      userId,
      proposalType: candidate.proposalType,
      targetPath: candidate.targetPath,
      beforeJson: beforeValue,
      afterJson: candidate.afterValue,
      rationale: candidate.rationale,
      evidenceJson: { validation, claimedSkills: candidate.claimedSkills },
      requiresConfirmation: !validation.safe,
      status: validation.safe ? (autoApprove ? "approved" : "proposed") : "blocked",
    });
  }
  return proposals;
}

export async function processAgentRun(userId, runId, requestId, execution = {}) {
  const initial = await getRunContext(userId, runId);
  if (["completed", "no_improvement", "cancelled"].includes(initial.run.status)) return publicRun(initial.run);
  if (initial.run.status === "failed") await clearRetryableProposals(runId);
  await updateRun(runId, { status: "analyzing", startedAt: initial.run.startedAt || new Date(), completedAt: null, errorCode: null, errorMessage: null });
  await recordAgentEvent({ runId, userId, eventType: "analysis_started", payloadJson: null });
  try {
    const resume = parseResumeSnapshot(initial.version.snapshotJson);
    const target = initial.target.requirementsJson;
    const scoreBefore = scoreResumeForTarget(resume, target, initial.target.type);
    await updateRun(runId, { scoreBeforeJson: scoreBefore });
    await recordAgentEvent({ runId, userId, eventType: "analysis_completed", payloadJson: { score: scoreBefore } });

    if (initial.run.mode === "analyze") {
      await releaseReservation(runId);
      const completed = await updateRun(runId, {
        status: "completed",
        scoreAfterJson: scoreBefore,
        resultJson: { changed: false, analysisOnly: true },
        completedAt: new Date(),
      });
      return publicRun(completed);
    }

    const modelResult = await resumeAgentModelGateway.proposeChanges({ resume, target, score: scoreBefore }, requestId);
    const candidateRows = proposalsFromModel({
      modelResult,
      resume,
      target,
      assertions: initial.assertions,
      sourceEvidenceText: initial.sourceEvidenceText,
      run: initial.run,
      userId,
    });
    const stored = await insertProposals(candidateRows);
    const safe = stored.filter((proposal) => !proposal.requiresConfirmation && proposal.status === "approved");
    const blocked = stored.filter((proposal) => proposal.requiresConfirmation);
    const patchResult = applyResumePatches(resume, safe.map((proposal) => ({
      op: "replace",
      path: proposal.targetPath,
      value: proposal.afterJson,
    })));
    const scoreAfter = scoreResumeForTarget(patchResult.resume, target, initial.target.type);

    if (!canCreateResumeVersion({ changeCount: safe.length, scoreBefore, scoreAfter })) {
      await releaseReservation(runId);
      const status = blocked.length ? "awaiting_confirmation" : "no_improvement";
      const updated = await updateRun(runId, {
        status,
        scoreAfterJson: scoreAfter,
        resultJson: {
          changed: false,
          keptOriginal: true,
          safeProposalCount: safe.length,
          confirmationRequiredCount: blocked.length,
          reason: safe.length === 0 ? "No evidence-safe changes were available" : "The candidate version reduced the transparent score",
        },
        completedAt: status === "no_improvement" ? new Date() : null,
      });
      await recordAgentEvent({ runId, userId, eventType: status, payloadJson: updated.resultJson });
      return publicRun(updated);
    }

    await updateRun(runId, { status: "validating", scoreAfterJson: scoreAfter });
    const source = initial.target.type === "platform_market"
      ? "platform_optimize"
      : initial.target.type === "career_job" ? "career_optimize" : "manual_jd";
    const finalized = await finalizeRunWithVersion({
      run: initial.run,
      resume: patchResult.resume,
      scoreAfter,
      source,
      changeSummary: modelResult.summary || `Optimized for ${initial.target.jobTitle}`,
      resultJson: {
        changed: true,
        appliedProposalCount: safe.length,
        confirmationRequiredCount: blocked.length,
        improvement: scoreAfter.overall - scoreBefore.overall,
        creditsCharged: CREDIT_COST[initial.target.type],
      },
      proposalIds: safe.map((proposal) => proposal.id),
    });
    return publicRun(finalized.run);
  } catch (error) {
    const attemptNumber = Number(execution.attemptNumber || 1);
    const maximumAttempts = Number(execution.maximumAttempts || 1);
    const retryable = isRetryableModelError(error);
    const retryScheduled = retryable && attemptNumber < maximumAttempts;
    const failure = publicRunFailure(error);
    await updateRun(runId, retryScheduled ? {
      status: "pending",
      errorCode: null,
      errorMessage: null,
      completedAt: null,
    } : {
      status: "failed",
      errorCode: failure.code,
      errorMessage: failure.message,
      completedAt: new Date(),
    });
    await recordAgentEvent({
      runId,
      userId,
      eventType: retryScheduled ? "run_retry_scheduled" : "run_failed",
      payloadJson: { attemptNumber, maximumAttempts, retryable, code: failure.code },
    });
    logger.error("Resume agent run attempt failed", {
      requestId,
      userId,
      runId,
      attemptNumber,
      maximumAttempts,
      retryable,
      retryScheduled,
      error: error.message,
      stack: error.stack,
    });
    throw error;
  }
}

export async function getAgentRun(userId, runId) {
  const context = await getRunContext(userId, runId);
  return {
    ...publicRun(context.run),
    target: {
      id: context.target.id,
      type: context.target.type,
      platform: context.target.platform,
      companyName: context.target.companyName,
      jobTitle: context.target.jobTitle,
      atsVendor: context.target.atsVendor,
      requirements: context.target.requirementsJson,
    },
    proposals: context.proposals.map((proposal) => ({
      id: proposal.id,
      type: proposal.proposalType,
      targetPath: proposal.targetPath,
      before: proposal.beforeJson,
      after: proposal.afterJson,
      rationale: proposal.rationale,
      requiresConfirmation: proposal.requiresConfirmation,
      status: proposal.status,
      violations: proposal.evidenceJson?.validation?.violations || [],
    })),
  };
}

export async function proposeChatEdit(userId, runId, instruction, requestId) {
  const context = await getRunContext(userId, runId);
  const resume = parseResumeSnapshot(context.version.snapshotJson);
  const target = context.target.requirementsJson;
  const score = scoreResumeForTarget(resume, target, context.target.type);
  const modelResult = await resumeAgentModelGateway.proposeChanges({ resume, target, score, instruction }, requestId);
  const rows = proposalsFromModel({
    modelResult,
    resume,
    target,
    assertions: context.assertions,
    sourceEvidenceText: context.sourceEvidenceText,
    run: context.run,
    userId,
    autoApprove: false,
  });
  const proposals = await insertProposals(rows);
  await recordAgentEvent({
    runId,
    userId,
    eventType: "chat_edit_proposed",
    payloadJson: { proposalIds: proposals.map((proposal) => proposal.id), instruction },
  });
  return {
    summary: modelResult.summary,
    proposals: proposals.map((proposal) => ({
      id: proposal.id,
      type: proposal.proposalType,
      targetPath: proposal.targetPath,
      before: proposal.beforeJson,
      after: proposal.afterJson,
      rationale: proposal.rationale,
      requiresConfirmation: proposal.requiresConfirmation,
      status: proposal.status,
      violations: proposal.evidenceJson?.validation?.violations || [],
    })),
  };
}

function factEvidence(input) {
  return {
    confirmation: input.confirmation,
    context: input.context || null,
    organizationOrProject: input.organizationOrProject || null,
    usageDetails: input.usageDetails || null,
    metric: input.metric || null,
    applyTo: input.applyTo || null,
    confirmedAt: new Date().toISOString(),
  };
}

export async function confirmMissingSkill(userId, runId, input, requestId) {
  const context = await getRunContext(userId, runId);
  const targetSkills = [
    ...(context.target.requirementsJson.requiredSkills || []),
    ...(context.target.requirementsJson.preferredSkills || []),
  ];
  const targetSkill = targetSkills.find((entry) => normalizeTerm(entry.name) === normalizeTerm(input.skill));
  if (!targetSkill) throw new AppError("That skill is not a gap for this resume target", 409);

  if (input.confirmation === "not_used") {
    const fact = await insertFact({
      userId,
      workspaceId: context.run.workspaceId,
      runId,
      factType: "skill",
      factKey: input.skill,
      valueJson: { skill: input.skill, possessed: false },
      evidenceJson: factEvidence(input),
      source: "user_attested",
      status: "rejected",
    });
    await recordAgentEvent({ runId, userId, eventType: "skill_gap_confirmed", payloadJson: { skill: input.skill, possessed: false } });
    return { changed: false, factId: fact.id, message: `${input.skill} remains a documented skill gap.` };
  }

  const fact = await insertFact({
    userId,
    workspaceId: context.run.workspaceId,
    runId,
    factType: "skill",
    factKey: input.skill,
    valueJson: { skill: input.skill, proficiencyContext: input.confirmation },
    evidenceJson: factEvidence(input),
    source: "user_attested",
    status: "verified",
  });

  const resume = parseResumeSnapshot(context.version.snapshotJson);
  const skillPath = defaultSkillPath(resume);
  let currentSkills;
  let skillPathExists = false;
  try {
    const value = readPointer(resume, skillPath);
    skillPathExists = value !== undefined;
    currentSkills = value || [];
  } catch {
    currentSkills = [];
  }
  if (!Array.isArray(currentSkills)) throw new AppError("The resume skill section is not in a supported format", 422);
  const updatedSkills = uniqueTerms([...currentSkills, input.skill]);
  const proposalRows = [{
    runId,
    userId,
    proposalType: "add_verified_skill",
    targetPath: skillPath,
    beforeJson: skillPathExists ? currentSkills : null,
    afterJson: updatedSkills,
    rationale: `Added after explicit user confirmation: ${input.confirmation}`,
    evidenceJson: { factId: fact.id, evidence: fact.evidenceJson, patchOp: skillPathExists ? "replace" : "add" },
    requiresConfirmation: false,
    status: "approved",
  }];

  const section = input.confirmation === "used_professionally" ? "experience" : input.confirmation === "used_in_project" ? "projects" : null;
  const evidenceOwner = section && input.organizationOrProject && Array.isArray(resume[section])
    ? resume[section].findIndex((entry) => normalizeTerm(JSON.stringify(entry)).includes(normalizeTerm(input.organizationOrProject)))
    : -1;
  if (section && evidenceOwner >= 0 && input.usageDetails) {
    const bulletPathExists = Array.isArray(resume[section][evidenceOwner].bullets);
    const bullets = bulletPathExists ? resume[section][evidenceOwner].bullets : [];
    const evidenceBullet = [input.usageDetails, input.metric].filter(Boolean).join(" — ");
    proposalRows.push({
      runId,
      userId,
      proposalType: "add_user_confirmed_evidence",
      targetPath: `/${section}/${evidenceOwner}/bullets`,
      beforeJson: bulletPathExists ? bullets : null,
      afterJson: [...bullets, evidenceBullet],
      rationale: "Added evidence exactly from the user's confirmation",
      evidenceJson: { factId: fact.id, patchOp: bulletPathExists ? "replace" : "add" },
      requiresConfirmation: false,
      status: "approved",
    });
  }

  const proposals = await insertProposals(proposalRows);
  const patched = applyResumePatches(resume, proposals.map((proposal) => ({
    op: proposal.evidenceJson?.patchOp || "replace",
    path: proposal.targetPath,
    value: proposal.afterJson,
  })));
  const beforeScore = scoreResumeForTarget(resume, context.target.requirementsJson, context.target.type);
  const afterScore = scoreResumeForTarget(patched.resume, context.target.requirementsJson, context.target.type);
  if (!canCreateResumeVersion({ changeCount: proposals.length, scoreBefore: beforeScore, scoreAfter: afterScore })) {
    await recordAgentEvent({ runId, userId, eventType: "confirmed_fact_saved_without_resume_change", payloadJson: { factId: fact.id, skill: input.skill } });
    return { changed: false, factId: fact.id, scoreBefore: beforeScore, scoreAfter: afterScore, message: "The fact was saved, but the resume was not changed because it reduced the resume score." };
  }

  await reserveCreditsForExistingRun(runId, userId, FOLLOWUP_EDIT_CREDIT_COST);
  try {
    const finalized = await finalizeRunWithVersion({
      run: context.run,
      resume: patched.resume,
      scoreAfter: afterScore,
      source: "fact_confirmation",
      changeSummary: `Added user-confirmed evidence for ${input.skill}`,
      resultJson: { changed: true, factId: fact.id, improvement: afterScore.overall - beforeScore.overall, creditsCharged: FOLLOWUP_EDIT_CREDIT_COST },
      proposalIds: proposals.map((proposal) => proposal.id),
    });
    logger.info("User-confirmed skill applied", { requestId, userId, runId, skill: input.skill, versionId: finalized.version.id });
    return { changed: true, factId: fact.id, versionId: finalized.version.id, scoreBefore: beforeScore, scoreAfter: afterScore };
  } catch (error) {
    await releaseReservation(runId);
    throw error;
  }
}
