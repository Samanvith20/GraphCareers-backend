import { AppError } from "../../lib/AppError.js";
import { RESUME_AGENT_TOOLS } from "./resumeAgent.tools.js";
import {
  careerTargetSchema,
  chatSchema,
  createRunSchema,
  listMessagesQuerySchema,
  manualTargetSchema,
  missingSkillConfirmationSchema,
  parseRequest,
  platformTargetSchema,
  proposalDecisionSchema,
  proposalIdParamsSchema,
  runIdParamsSchema,
  targetIdParamsSchema,
} from "./resumeAgent.schemas.js";
import { createCareerTarget, createManualTarget, createPlatformTarget } from "./resumeAgent.targetService.js";
import { confirmMissingSkill, createAgentRun, getAgentRun } from "./resumeAgent.runService.js";
import { getResumeAgentMessages, chatWithResumeAgent } from "./resumeAgent.chatService.js";
import { decideProposal } from "./resumeAgent.proposalService.js";
import { generateValidatedResumeDocument } from "./resumeAgent.documentService.js";
import { getWorkspaceOverview, listRunEvents, requireTarget, requireVersion } from "./resumeAgent.repository.js";

function handler(fn) {
  return async (req, res, next) => {
    try {
      await fn(req, res);
    } catch (error) {
      if (error.name === "RequestValidationError") return next(new AppError(error.message, 400));
      next(error);
    }
  };
}

function parseStoredJson(value, fallback = null) {
  if (value === null || value === undefined || value === "") return fallback;
  if (typeof value === "object") return value;
  try {
    return JSON.parse(value);
  } catch {
    return fallback;
  }
}

export const listToolsHandler = handler(async (_req, res) => {
  res.json({ success: true, tools: RESUME_AGENT_TOOLS });
});

export const getWorkspaceHandler = handler(async (req, res) => {
  const result = await getWorkspaceOverview(req.userId, req.requestId);
  res.json({
    success: true,
    workspace: {
      id: result.workspace.id,
      status: result.workspace.status,
      activeVersionId: result.workspace.activeVersionId,
      totalVersions: result.workspace.totalVersions,
      totalOptimizations: result.workspace.totalOptimizations,
    },
    versions: result.versions.map((version) => ({
      ...version,
      sourceMetadata: parseStoredJson(version.sourceMetadata),
    })),
  });
});

export const getVersionHandler = handler(async (req, res) => {
  const versionId = parseRequest(targetIdParamsSchema, { id: req.params.versionId }).id;
  const { version } = await requireVersion(req.userId, versionId);
  res.json({
    success: true,
    version: {
      ...version,
      snapshotJson: parseStoredJson(version.snapshotJson, {}),
      sourceMetadata: parseStoredJson(version.sourceMetadata),
    },
  });
});

export const createPlatformTargetHandler = handler(async (req, res) => {
  const input = parseRequest(platformTargetSchema, req.body);
  const target = await createPlatformTarget(req.userId, input, req.requestId);
  res.status(201).json({ success: true, target });
});

export const createCareerTargetHandler = handler(async (req, res) => {
  const input = parseRequest(careerTargetSchema, req.body);
  const target = await createCareerTarget(req.userId, input, req.requestId);
  res.status(201).json({ success: true, target });
});

export const createManualTargetHandler = handler(async (req, res) => {
  const input = parseRequest(manualTargetSchema, req.body);
  const target = await createManualTarget(req.userId, input, req.requestId);
  res.status(201).json({ success: true, target });
});

export const getTargetHandler = handler(async (req, res) => {
  const { id } = parseRequest(targetIdParamsSchema, req.params);
  const target = await requireTarget(req.userId, id);
  res.json({ success: true, target: { ...target, sourceSnapshotJson: undefined } });
});

export const createRunHandler = handler(async (req, res) => {
  const input = parseRequest(createRunSchema, req.body);
  const run = await createAgentRun(req.userId, input, req.requestId);
  res.status(run.idempotentReplay ? 200 : 202).json({ success: true, run });
});

export const getRunHandler = handler(async (req, res) => {
  const { id } = parseRequest(runIdParamsSchema, req.params);
  res.json({ success: true, run: await getAgentRun(req.userId, id) });
});

export const getRunEventsHandler = handler(async (req, res) => {
  const { id } = parseRequest(runIdParamsSchema, req.params);
  res.json({ success: true, events: await listRunEvents(req.userId, id) });
});

export const chatHandler = handler(async (req, res) => {
  const { id } = parseRequest(runIdParamsSchema, req.params);
  const input = parseRequest(chatSchema, req.body);
  res.json({ success: true, ...(await chatWithResumeAgent(req.userId, id, input, req.requestId)) });
});

export const getMessagesHandler = handler(async (req, res) => {
  const { id } = parseRequest(runIdParamsSchema, req.params);
  const query = parseRequest(listMessagesQuerySchema, req.query);
  res.json({ success: true, messages: await getResumeAgentMessages(req.userId, id, query) });
});

export const confirmMissingSkillHandler = handler(async (req, res) => {
  const { id } = parseRequest(runIdParamsSchema, req.params);
  const input = parseRequest(missingSkillConfirmationSchema, req.body);
  res.json({ success: true, result: await confirmMissingSkill(req.userId, id, input, req.requestId) });
});

export const decideProposalHandler = handler(async (req, res) => {
  const { id } = parseRequest(proposalIdParamsSchema, req.params);
  const { decision } = parseRequest(proposalDecisionSchema, req.body);
  res.json({ success: true, proposal: await decideProposal(req.userId, id, decision) });
});

export const downloadVersionHandler = handler(async (req, res) => {
  const versionId = parseRequest(targetIdParamsSchema, { id: req.params.versionId }).id;
  const format = String(req.params.format || "").toLowerCase();
  const result = await generateValidatedResumeDocument(req.userId, versionId, format);
  const name = String(result.resume?.contact?.name || "Candidate").replace(/[^a-z0-9]+/gi, "_");
  res.setHeader("X-Resume-Parse-Coverage", String(result.validation.textCoverage));
  if (format === "pdf") res.type("application/pdf");
  else res.type("application/vnd.openxmlformats-officedocument.wordprocessingml.document");
  res.setHeader("Content-Disposition", `attachment; filename="${name}_Resume.${format}"`);
  res.send(result.buffer);
});
