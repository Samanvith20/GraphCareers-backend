import { AppError } from "../lib/AppError.js";
import { db } from "../db/index.js";
import { resumeOptimizations, users } from "../db/schema.js";
import { eq, and, inArray } from "drizzle-orm";
import { resumeOptimizationQueue } from "../queue/resumeOptimizationQueue.js";
import { generatePdf, generateDocx } from "../services/documentGenerator.service.js";
import logger from "../logger/logger.js";
import { consumeUserCredits, getUserAccessFromUser } from "../services/userAccess.service.js";

export const optimizeResumeTrigger = async (req, res, next) => {
  try {
    const userId = req.userId;
    const { platform } = req.params;
    const { requestId } = req;
    const idempotencyKey = req.headers["idempotency-key"] || `${userId}-${platform}`;

    // 1. Enforce Global Rate Limiting & Deduplication (Max 1 active job across any platform)
    const [activeJob] = await db
      .select()
      .from(resumeOptimizations)
      .where(
        and(
          eq(resumeOptimizations.userId, userId),
          inArray(resumeOptimizations.status, ["pending", "processing"])
        )
      );

    if (activeJob) {
      if (activeJob.platform === platform) {
        return res.status(202).json({
          success: true,
          message: "Optimization is already in progress",
          status: activeJob.status,
        });
      } else {
        throw new AppError(`You already have an active optimization running for ${activeJob.platform}. Please wait for it to finish.`, 429);
      }
    }

    // 2. 6-Hour Cache Rule (Cost Savings) - TEMPORARILY DISABLED FOR TESTING
    const [existing] = await db
      .select()
      .from(resumeOptimizations)
      .where(and(eq(resumeOptimizations.userId, userId), eq(resumeOptimizations.platform, platform)));

    
    if (existing && existing.status === "completed" && existing.updatedAt) {
      const hoursSinceOptimization = (new Date() - new Date(existing.updatedAt)) / (1000 * 60 * 60);
      if (hoursSinceOptimization < 6) {
        return res.status(200).json({
          success: true,
          message: "Optimization returned from cache",
          status: "completed",
          cached: true
        });
      }
    }
    

    // 3. Check Credits Before Proceeding
    const [user] = await db.select().from(users).where(eq(users.id, userId));
    const access = getUserAccessFromUser(user);
    if (user.credits < 2 && access.tier !== "PRO") {
      throw new AppError("Insufficient credits. Resume optimization requires 2 credits.", 402);
    }

    // 4. Queue Job (using idempotency key)
    const jobId = idempotencyKey;
    await resumeOptimizationQueue.add(
      "optimizeResume",
      { userId, platform, requestId },
      { jobId } // Deduplicates active jobs
    );

    // 5. Upsert pending record
    await db
      .insert(resumeOptimizations)
      .values({ userId, platform, status: "pending", updatedAt: new Date() })
      .onConflictDoUpdate({
        target: [resumeOptimizations.userId, resumeOptimizations.platform],
        set: { status: "pending", errorMessage: null, updatedAt: new Date() },
      });

    logger.info("Resume optimization queued", { requestId, userId, platform });

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
    const userId    = req.userId;
    const { platform } = req.params;

    const [optRecord] = await db
      .select()
      .from(resumeOptimizations)
      .where(and(eq(resumeOptimizations.userId, userId), eq(resumeOptimizations.platform, platform)));

    if (!optRecord) {
      return res.status(404).json({
        success: false,
        message: "Optimization not found for this platform",
      });
    }

    // ── Base response (always present) ────────────────────────────────────────
    const response = {
      success:   true,
      platform:  optRecord.platform,
      status:    optRecord.status,
      createdAt: optRecord.createdAt,
      updatedAt: optRecord.updatedAt,
    };

    // ── Completed: return full resume build payload ────────────────────────────
    if (optRecord.status === "completed") {

      // Parse all JSON fields safely
      const optimizedResume    = optRecord.optimizedJson     ? JSON.parse(optRecord.optimizedJson)     : null;
      const masterResume       = optRecord.masterResumeJson  ? JSON.parse(optRecord.masterResumeJson)  : null;
      const scoreDetails       = optRecord.scoreDetails      ? JSON.parse(optRecord.scoreDetails)      : null;
      const skillRecs          = optRecord.skillRecommendations ? JSON.parse(optRecord.skillRecommendations) : [];

      response.atsScores = {
        before:      optRecord.scoreBefore,
        after:       optRecord.scoreAfter,
        improvement: (optRecord.scoreAfter ?? 0) - (optRecord.scoreBefore ?? 0),
        breakdown: {
          before: scoreDetails?.before  ?? null,
          after:  scoreDetails?.after   ?? null,
        },
      };

      // Full optimized resume — all sections the AI produced
      // masterResume is included as a fallback: frontend uses it for any section
      // that may be null/empty in optimizedResume (edge case safety net)
      response.optimizedResume = {
        contact:           optimizedResume?.contact        ?? masterResume?.contact        ?? null,
        summary:           optimizedResume?.summary        ?? masterResume?.summary        ?? null,
        experience:        optimizedResume?.experience     ?? masterResume?.experience     ?? [],
        projects:          optimizedResume?.projects       ?? masterResume?.projects       ?? [],
        skills:            optimizedResume?.skills         ?? masterResume?.skills         ?? {},
        education:         optimizedResume?.education      ?? masterResume?.education      ?? [],
        certifications:    optimizedResume?.certifications ?? masterResume?.certifications ?? [],
        optimizationNotes: optimizedResume?.optimizationNotes ?? [],
      };

      // Keyword tracking for the ATS keyword panel
      response.keywords = {
        matched: optRecord.keywordsMatched ?? [],
        missing: optRecord.keywordsMissing ?? [],
        added:   optRecord.keywordsAdded   ?? [],
      };

      // Structured "skills to learn" panel — skills the user doesn't have
      // Each item: { skill, demandPct, jobCount, importance, learnMessage }
      response.skillRecommendations = skillRecs;

      // Platform context for the frontend summary card
      response.platformInsights = {
        topSkills:              scoreDetails?.topPlatformSkills        ?? [],
        experienceDistribution: scoreDetails?.experienceDistribution   ?? {},
        workModeDistribution:   scoreDetails?.workModeDistribution     ?? {},
      };

      // Structural improvement tips
      response.recommendations = scoreDetails?.structuralRecommendations ?? [];

    } else if (optRecord.status === "failed") {
      response.errorMessage = optRecord.errorMessage;
    }

    logger.info("Optimization status fetched", {
      requestId: req.requestId,
      userId,
      platform,
      status:    optRecord.status,
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
