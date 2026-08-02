import { getOptimizationReport, chatWithCopilot } from "../services/resumeCopilot.service.js";
import { z } from "zod";
import { db } from "../db/index.js";
import { resumeWorkspaces } from "../db/schema.js";
import { eq } from "drizzle-orm";
import { AppError } from "../lib/AppError.js";

const copilotChatSchema = z
  .object({
    message: z.string().optional(),
    prompt: z.string().optional(),
    content: z.string().optional(),
    messages: z.array(z.object({ role: z.string().optional(), content: z.string().optional() })).optional(),
  })
  .transform((data) => {
    let msg = data.message || data.prompt || data.content || "";
    if (!msg && Array.isArray(data.messages) && data.messages.length > 0) {
      const lastUser = [...data.messages].reverse().find((m) => m.role === "user" || m.content);
      msg = lastUser?.content || data.messages[data.messages.length - 1]?.content || "";
    }
    return { message: (msg || "").trim() };
  })
  .refine((data) => data.message.length > 0, {
    message: "Message is required",
  });

async function resolveVersionId(versionIdParam, userId) {
  if (!versionIdParam) {
    throw new AppError("Version ID or platform param is required", 400);
  }
  
  const isUuid = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-8][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}$/.test(versionIdParam);
  if (isUuid) return versionIdParam;

  // Otherwise, fallback to the user's active workspace version ID
  const [workspace] = await db
    .select()
    .from(resumeWorkspaces)
    .where(eq(resumeWorkspaces.userId, userId));

  if (workspace?.activeVersionId) {
    return workspace.activeVersionId;
  }
  throw new AppError(`No active resume version found. Please upload or optimize your resume first.`, 404);
}

/**
 * GET /resume/:version/report
 */
export const getOptimizationReportHandler = async (req, res, next) => {
  try {
    const versionId = await resolveVersionId(req.params.versionId, req.userId);
    const report = await getOptimizationReport(versionId, req.userId);

    res.json({ success: true, report });
  } catch (err) {
    next(err);
  }
};

/**
 * POST /resume/copilot/:versionId/chat
 */
export const copilotChatHandler = async (req, res, next) => {
  try {
    const versionId = await resolveVersionId(req.params.versionId, req.userId);
    const { message } = copilotChatSchema.parse(req.body);

    const response = await chatWithCopilot(versionId, req.userId, message, req.requestId);

    res.setHeader("Content-Type", "text/plain; charset=utf-8");
    res.write(`0:${JSON.stringify(response.reply)}\n`);
    res.end();
  } catch (err) {
    if (err instanceof z.ZodError || err?.name === "ZodError") {
      const msg = err.issues?.[0]?.message || err.errors?.[0]?.message || err.message || "Validation Error";
      return next(new AppError(msg, 400));
    }
    next(err);
  }
};
