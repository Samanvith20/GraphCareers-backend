import { getOptimizationReport, chatWithCopilot } from "../services/resumeCopilot.service.js";
import { z } from "zod";

const versionIdParamSchema = z.object({
  versionId: z.string().uuid("Invalid version ID"),
});

const copilotChatSchema = z.object({
  message: z.string().min(1, "Message is required"),
});

/**
 * GET /resume/:version/report
 */
export const getOptimizationReportHandler = async (req, res, next) => {
  try {
    const { versionId } = versionIdParamSchema.parse(req.params);

    const report = await getOptimizationReport(versionId, req.userId);

    res.json({ success: true, report });
  } catch (err) {
    next(err);
  }
};

/**
 * POST /resume/copilot/chat/:versionId
 */
export const copilotChatHandler = async (req, res, next) => {
  try {
    const { versionId } = versionIdParamSchema.parse(req.params);
    const { message } = copilotChatSchema.parse(req.body);

    const response = await chatWithCopilot(versionId, req.userId, message, req.requestId);

    res.json({ success: true, reply: response.reply });
  } catch (err) {
    next(err);
  }
};
