import { AppError } from "../../lib/AppError.js";
import { applyResumePatches } from "./domain/patches.js";
import { parseResumeSnapshot } from "./domain/resume.js";
import { scoreResumeForTarget } from "./domain/scoring.js";
import { canCreateResumeVersion } from "./domain/versionPolicy.js";
import {
  finalizeRunWithVersion,
  getRunContext,
  recordAgentEvent,
  reserveCreditsForExistingRun,
  releaseReservation,
  requireProposal,
  updateProposal,
} from "./resumeAgent.repository.js";
import { FOLLOWUP_EDIT_CREDIT_COST } from "./resumeAgent.runService.js";

export async function decideProposal(userId, proposalId, decision) {
  const proposal = await requireProposal(userId, proposalId);
  if (["applied", "rejected"].includes(proposal.status)) return proposal;
  if (decision === "reject") {
    const rejected = await updateProposal(proposalId, { status: "rejected", decidedAt: new Date() });
    await recordAgentEvent({ runId: proposal.runId, userId, eventType: "proposal_rejected", payloadJson: { proposalId } });
    return rejected;
  }
  if (proposal.requiresConfirmation || proposal.status === "blocked") {
    throw new AppError("This proposal needs supporting evidence. Confirm the missing fact instead of approving it directly.", 409);
  }

  const context = await getRunContext(userId, proposal.runId);
  const resume = parseResumeSnapshot(context.version.snapshotJson);
  const patched = applyResumePatches(resume, [{
    op: proposal.evidenceJson?.patchOp || "replace",
    path: proposal.targetPath,
    value: proposal.afterJson,
  }]);
  const beforeScore = scoreResumeForTarget(resume, context.target.requirementsJson, context.target.type);
  const afterScore = scoreResumeForTarget(patched.resume, context.target.requirementsJson, context.target.type);
  if (!canCreateResumeVersion({ changeCount: 1, scoreBefore: beforeScore, scoreAfter })) {
    await updateProposal(proposalId, { status: "rejected", decidedAt: new Date() });
    throw new AppError("The proposal was not applied because it did not improve the resume score", 409);
  }
  await updateProposal(proposalId, { status: "approved", decidedAt: new Date() });
  await reserveCreditsForExistingRun(context.run.id, userId, FOLLOWUP_EDIT_CREDIT_COST);
  try {
    const finalized = await finalizeRunWithVersion({
      run: context.run,
      resume: patched.resume,
      scoreAfter: afterScore,
      source: "agent_chat",
      changeSummary: proposal.rationale,
      resultJson: { changed: true, proposalId, improvement: afterScore.overall - beforeScore.overall, creditsCharged: FOLLOWUP_EDIT_CREDIT_COST },
      proposalIds: [proposal.id],
    });
    return { ...proposal, status: "applied", outputVersionId: finalized.version.id, scoreAfter: afterScore };
  } catch (error) {
    await releaseReservation(context.run.id);
    throw error;
  }
}
