import { AppError } from "../lib/AppError.js";
import { db } from "../db/index.js";
import { resumeOptimizations, users } from "../db/schema.js";
import { eq, and, inArray } from "drizzle-orm";
import { generatePdf, generateDocx } from "../services/documentGenerator.service.js";
import logger from "../logger/logger.js";
import { queuePlatformOptimization, getOptimizationStatus } from "../orchestrators/resume.orchestrator.js";

export const optimizeResumeTrigger = async (req, res, next) => {
  try {
    const userId = req.userId;
    const { platform } = req.params;
    const { requestId } = req;
    // The Orchestrator handles rate limiting, credits, enqueuing, and DB upserts.
    const result = await queuePlatformOptimization(userId, platform, requestId);

    res.status(202).json(result);
  } catch (err) {
    next(err);
  }
};

export const getOptimizationStatusHandler = async (req, res, next) => {
  try {
    const userId = req.userId;
    const { platform } = req.params;

    const response = await getOptimizationStatus(userId, platform, req.requestId);

    logger.info("Optimization status fetched via orchestrator", {
      requestId: req.requestId,
      userId,
      platform,
      status: response.status,
    });

    res.json(response);

  } catch (err) {
    next(err);
  }
};


export const downloadPdf = async (req, res, next) => {
  try {
    const userId = req.userId;
    const { platform } = req.params;

    const [optRecord] = await db
      .select()
      .from(resumeOptimizations)
      .where(and(eq(resumeOptimizations.userId, userId), eq(resumeOptimizations.platform, platform)));

    if (!optRecord || optRecord.status !== "completed" || !optRecord.optimizedJson) {
      throw new AppError("Optimized resume not found or not yet complete", 404);
    }

    const optimizedJson = JSON.parse(optRecord.optimizedJson);
    const userName = (optimizedJson.contact?.name || "Candidate").replace(/[^a-zA-Z0-9]/g, "_");
    const filename = `${userName}_${platform}_Resume.pdf`;

    const pdfBuffer = await generatePdf(optimizedJson);

    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
    res.send(pdfBuffer);
  } catch (err) {
    next(err);
  }
};

export const downloadDocx = async (req, res, next) => {
  try {
    const userId = req.userId;
    const { platform } = req.params;

    const [optRecord] = await db
      .select()
      .from(resumeOptimizations)
      .where(and(eq(resumeOptimizations.userId, userId), eq(resumeOptimizations.platform, platform)));

    if (!optRecord || optRecord.status !== "completed" || !optRecord.optimizedJson) {
      throw new AppError("Optimized resume not found or not yet complete", 404);
    }

    const optimizedJson = JSON.parse(optRecord.optimizedJson);
    const userName = (optimizedJson.contact?.name || "Candidate").replace(/[^a-zA-Z0-9]/g, "_");
    const filename = `${userName}_${platform}_Resume.docx`;

    const docxBuffer = await generateDocx(optimizedJson);

    res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.wordprocessingml.document");
    res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
    res.send(docxBuffer);
  } catch (err) {
    next(err);
  }
};
