import { z } from "zod";
import { executeResumeEdit } from "../orchestrators/resumeEditor.orchestrator.js";
import logger from "../logger/logger.js";

const editActionSchema = z.object({
  actionType: z.string().min(1, "Action type is required"),
  instructions: z.string().optional(),
  targetPath: z.string().optional(),
  workspaceId: z.string().uuid("Invalid workspace ID"),
});

/**
 * POST /api/resume/edit/:versionId
 */
export const resumeEditHandler = async (req, res, next) => {
  try {
    const { versionId } = req.params;
    const editAction = editActionSchema.parse(req.body);

    logger.info("Received resume edit request", {
      requestId: req.requestId,
      userId: req.userId,
      versionId,
      actionType: editAction.actionType
    });

    const result = await executeResumeEdit(req.userId, editAction.workspaceId, versionId, editAction, req.requestId);

    res.json(result);
  } catch (err) {
    next(err);
  }
};
