import { AppError } from "../lib/AppError.js";
import { db } from "../db/index.js";
import { resumeOptimizations, users } from "../db/schema.js";
import { eq, and } from "drizzle-orm";
import { resumeOptimizationQueue } from "../queue/resumeOptimizationQueue.js";
import { generatePdf, generateDocx } from "../services/documentGenerator.service.js";
import logger from "../logger/logger.js";
import { consumeUserCredits, getUserAccessFromUser } from "../services/userAccess.service.js";

export const optimizeResumeTrigger = async (req, res, next) => {
  try {
    const userId = req.user.id;
    const { jobSourceId } = req.params;
    const { requestId } = req;

    // 1. Check Credits First
    const [user] = await db.select().from(users).where(eq(users.id, userId));
    const access = getUserAccessFromUser(user);
    if (user.credits < 2 && access.tier !== "PRO") {
      throw new AppError("Insufficient credits. Resume optimization requires 2 credits.", 402);
    }

    // 2. Check if already pending/processing
    const [existing] = await db
      .select()
      .from(resumeOptimizations)
      .where(and(eq(resumeOptimizations.userId, userId), eq(resumeOptimizations.jobSourceId, jobSourceId)));

    if (existing && (existing.status === "pending" || existing.status === "processing")) {
      return res.status(202).json({
        success: true,
        message: "Optimization is already in progress",
        status: existing.status,
      });
    }

    // 3. Queue Job
    const jobId = \`\${userId}:\${jobSourceId}\`;
    await resumeOptimizationQueue.add(
      "optimizeResume",
      { userId, jobSourceId, requestId },
      { jobId } // Deduplicates active jobs
    );

    // 4. Upsert pending record
    await db
      .insert(resumeOptimizations)
      .values({ userId, jobSourceId, status: "pending" })
      .onConflictDoUpdate({
        target: [resumeOptimizations.userId, resumeOptimizations.jobSourceId],
        set: { status: "pending", errorMessage: null },
      });

    logger.info("Resume optimization queued", { requestId, userId, jobSourceId });

    res.status(202).json({
      success: true,
      message: "Resume optimization started",
      status: "pending",
    });
  } catch (err) {
    next(err);
  }
};

export const getOptimizationStatus = async (req, res, next) => {
  try {
    const userId = req.user.id;
    const { jobSourceId } = req.params;

    const [optRecord] = await db
      .select()
      .from(resumeOptimizations)
      .where(and(eq(resumeOptimizations.userId, userId), eq(resumeOptimizations.jobSourceId, jobSourceId)));

    if (!optRecord) {
      return res.status(404).json({ success: false, message: "Optimization not found for this job" });
    }

    const response = {
      success: true,
      status: optRecord.status,
      createdAt: optRecord.createdAt,
      updatedAt: optRecord.updatedAt,
    };

    if (optRecord.status === "completed") {
      response.scoreBefore = optRecord.scoreBefore;
      response.scoreAfter = optRecord.scoreAfter;
      
      // Parse JSON fields safely
      response.optimizedJson = optRecord.optimizedJson ? JSON.parse(optRecord.optimizedJson) : null;
      response.scoreDetails = optRecord.scoreDetails ? JSON.parse(optRecord.scoreDetails) : null;
      
      response.keywordsMatched = optRecord.keywordsMatched;
      response.keywordsMissing = optRecord.keywordsMissing;
      response.keywordsAdded = optRecord.keywordsAdded;
    } else if (optRecord.status === "failed") {
      response.errorMessage = optRecord.errorMessage;
    }

    res.json(response);
  } catch (err) {
    next(err);
  }
};

export const downloadPdf = async (req, res, next) => {
  try {
    const userId = req.user.id;
    const { jobSourceId } = req.params;

    const [optRecord] = await db
      .select()
      .from(resumeOptimizations)
      .where(and(eq(resumeOptimizations.userId, userId), eq(resumeOptimizations.jobSourceId, jobSourceId)));

    if (!optRecord || optRecord.status !== "completed" || !optRecord.optimizedJson) {
      throw new AppError("Optimized resume not found or not yet complete", 404);
    }

    const pdfBuffer = await generatePdf(JSON.parse(optRecord.optimizedJson));

    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", \`attachment; filename="Optimized_Resume_\${jobSourceId}.pdf"\`);
    res.send(pdfBuffer);
  } catch (err) {
    next(err);
  }
};

export const downloadDocx = async (req, res, next) => {
  try {
    const userId = req.user.id;
    const { jobSourceId } = req.params;

    const [optRecord] = await db
      .select()
      .from(resumeOptimizations)
      .where(and(eq(resumeOptimizations.userId, userId), eq(resumeOptimizations.jobSourceId, jobSourceId)));

    if (!optRecord || optRecord.status !== "completed" || !optRecord.optimizedJson) {
      throw new AppError("Optimized resume not found or not yet complete", 404);
    }

    const docxBuffer = await generateDocx(JSON.parse(optRecord.optimizedJson));

    res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.wordprocessingml.document");
    res.setHeader("Content-Disposition", \`attachment; filename="Optimized_Resume_\${jobSourceId}.docx"\`);
    res.send(docxBuffer);
  } catch (err) {
    next(err);
  }
};
