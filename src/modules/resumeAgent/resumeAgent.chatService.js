import { normalizeTerm } from "./domain/text.js";
import { scoreResumeForTarget } from "./domain/scoring.js";
import { parseResumeSnapshot } from "./domain/resume.js";
import { resumeAgentModelGateway } from "./resumeAgent.modelGateway.js";
import { getRunContext, insertMessage, listMessages } from "./resumeAgent.repository.js";
import { proposeChatEdit } from "./resumeAgent.runService.js";

function findMentionedGap(message, score) {
  const normalizedMessage = normalizeTerm(message);
  const gaps = [
    ...(score?.targetMatch?.missingRequiredSkills || []),
    ...(score?.targetMatch?.missingPreferredSkills || []),
  ];
  return gaps.find((skill) => normalizedMessage.includes(normalizeTerm(skill))) || null;
}

function asksToAdd(message) {
  return /\b(add|include|insert|put|mention|show)\b/i.test(message);
}

function asksToEdit(message) {
  return /\b(rewrite|shorten|improve|change|update|reorder|emphasize|emphasise|tailor|make .* stronger)\b/i.test(message);
}

function evidenceQuestion(skill) {
  return `Before I add ${skill}, please confirm how you have used it: professionally, in a project, through a course, as basic knowledge, or not at all. For professional or project use, include where you used it and what you did.`;
}

export async function chatWithResumeAgent(userId, runId, input, requestId) {
  const context = await getRunContext(userId, runId);
  const userInsert = await insertMessage({
    runId,
    userId,
    role: "user",
    content: input.message,
    clientMessageId: input.clientMessageId || null,
  });
  if (!userInsert.created) {
    const messages = await listMessages(userId, runId, { limit: 2 });
    const priorAssistant = messages.findLast((message) => message.role === "assistant");
    return { reply: priorAssistant?.content || "That message was already processed.", replayed: true, metadata: priorAssistant?.metadataJson || null };
  }

  const resume = parseResumeSnapshot(context.version.snapshotJson);
  const score = context.run.scoreAfterJson || context.run.scoreBeforeJson || scoreResumeForTarget(
    resume,
    context.target.requirementsJson,
    context.target.type,
  );
  const mentionedGap = findMentionedGap(input.message, score);
  let reply;
  let intent = "explain_or_advise";
  let metadata = null;

  if (mentionedGap && asksToAdd(input.message)) {
    intent = "confirm_missing_skill";
    reply = evidenceQuestion(mentionedGap);
    metadata = {
      action: "confirm_missing_skill",
      skill: mentionedGap,
      options: ["used_professionally", "used_in_project", "completed_course", "basic_knowledge", "not_used"],
    };
  } else if (asksToEdit(input.message)) {
    intent = "propose_resume_edit";
    const result = await proposeChatEdit(userId, runId, input.message, requestId);
    if (result.proposals.length === 0) {
      reply = "I could not produce an evidence-safe improvement for that instruction, so I left the resume unchanged.";
      metadata = { action: "none", reason: result.summary };
    } else {
      const safeCount = result.proposals.filter((proposal) => !proposal.requiresConfirmation).length;
      const blockedCount = result.proposals.length - safeCount;
      reply = `I prepared ${result.proposals.length} change${result.proposals.length === 1 ? "" : "s"}: ${safeCount} can be reviewed and applied now${blockedCount ? `, and ${blockedCount} need supporting evidence` : ""}.`;
      metadata = { action: "review_proposals", ...result };
    }
  } else {
    reply = await resumeAgentModelGateway.answer({
      message: input.message,
      context: {
        run: { id: context.run.id, status: context.run.status },
        target: {
          type: context.target.type,
          jobTitle: context.target.jobTitle,
          companyName: context.target.companyName,
          atsVendor: context.target.atsVendor,
          requirements: context.target.requirementsJson,
        },
        score,
        resume,
        verifiedFacts: context.assertions.map((fact) => ({
          type: fact.factType,
          key: fact.factKey,
          value: fact.valueJson,
          evidence: fact.evidenceJson,
          source: fact.source,
        })),
        proposals: context.proposals.map((proposal) => ({
          id: proposal.id,
          type: proposal.proposalType,
          status: proposal.status,
          rationale: proposal.rationale,
          requiresConfirmation: proposal.requiresConfirmation,
        })),
      },
    }, requestId);
  }

  await insertMessage({ runId, userId, role: "assistant", content: reply, intent, metadataJson: metadata });
  return { reply, intent, metadata, replayed: false };
}

export async function getResumeAgentMessages(userId, runId, query) {
  return listMessages(userId, runId, query);
}
