import "dotenv/config";
import { Worker } from "bullmq";
import { connection } from "../queue/connection.js";
import logger from "../logger/logger.js";
import { optimizeResumeForPlatform } from "../services/resumeOptimizer.service.js";
import Sentry from "../lib/sentry.js";

const worker = new Worker(
  "resumeOptimization",
  async (job) => {
    const { userId, platform, requestId } = job.data;
    logger.info("Processing targeted resume optimization job", {
      jobId: job.id,
      userId,
      platform,
      requestId,
    });

    await optimizeResumeForPlatform({ userId, platform, requestId });
  },
  {
    connection,
    concurrency: parseInt(process.env.RESUME_WORKER_CONCURRENCY) || 2, // Heavy LLM/Neo4j ops
  }
);

worker.on("completed", (job) => {
  logger.info("Resume optimization job completed successfully", {
    jobId: job.id,
    userId: job.data.userId,
    platform: job.data.platform,
  });
});

worker.on("failed", (job, err) => {
  logger.error("Resume optimization job failed", {
    jobId: job?.id,
    userId: job?.data?.userId,
    error: err.message,
    stack: err.stack,
  });
  
  if (Sentry) {
    Sentry.captureException(err, {
      tags: { worker: "resumeOptimization" },
      extra: { jobId: job?.id, userId: job?.data?.userId },
    });
  }
});

export default worker;
