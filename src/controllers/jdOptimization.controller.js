import { executeJdOptimization } from "../services/jdOptimization.service.js";
import { jdOptimizationSchema } from "../schemas/jdAnalysis.schema.js";
import logger from "../logger/logger.js";
import { z } from "zod";

const paramsSchema = z.object({
  versionId: z.string().uuid("Invalid version ID"),
});

const bodySchema = jdOptimizationSchema.extend({
  workspaceId: z.string().uuid("Invalid workspace ID"),
});

/**
 * POST /api/resume/jd-optimize/:versionId
 */
export const jdOptimizeHandler = async (req, res, next) => {
  try {
    const { versionId } = paramsSchema.parse(req.params);
    const payload = bodySchema.parse(req.body);

    logger.info("Received JD Optimization request", {
      requestId: req.requestId,
      userId: req.userId,
      versionId,
      companyName: payload.companyName,
      jobTitle: payload.jobTitle,
    });

    const result = await executeJdOptimization(req.userId, payload.workspaceId, versionId, payload, req.requestId);

    res.json(result);
  } catch (err) {
    next(err);
  }
};
