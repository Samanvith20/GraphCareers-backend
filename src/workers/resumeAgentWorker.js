import "dotenv/config";
import { UnrecoverableError, Worker } from "bullmq";
import { connection } from "../queue/connection.js";
import logger from "../logger/logger.js";
import Sentry from "../lib/sentry.js";
import { processAgentRun } from "../modules/resumeAgent/resumeAgent.runService.js";
import { isRetryableModelError } from "../modules/resumeAgent/resumeAgent.modelGateway.js";
import { releaseReservation } from "../modules/resumeAgent/resumeAgent.repository.js";

const worker = new Worker(
  "resumeAgentV2",
  async (job) => {
    const { runId, userId, requestId } = job.data;
    const maximumAttempts = Number(job.opts.attempts || 1);
    const attemptNumber = job.attemptsMade + 1;
    logger.info("Resume agent run started", { requestId, jobId: job.id, runId, userId });
    try {
      return await processAgentRun(userId, runId, requestId, { attemptNumber, maximumAttempts });
    } catch (error) {
      const retryable = isRetryableModelError(error);
      const isFinalAttempt = !retryable || attemptNumber >= maximumAttempts;
      if (isFinalAttempt) await releaseReservation(runId);
      if (!retryable) throw new UnrecoverableError(error.message);
      throw error;
    }
  },
  {
    connection,
    concurrency: Number(process.env.RESUME_AGENT_WORKER_CONCURRENCY) || 4,
    lockDuration: Number(process.env.RESUME_AGENT_LOCK_DURATION_MS) || 60_000,
  },
);

logger.info("Resume agent worker started", {
  queue: "resumeAgentV2",
  concurrency: Number(process.env.RESUME_AGENT_WORKER_CONCURRENCY) || 4,
});

worker.on("completed", (job) => {
  logger.info("Resume agent run completed", { jobId: job.id, runId: job.data.runId, userId: job.data.userId });
});

worker.on("failed", (job, error) => {
  logger.error("Resume agent worker job failed", {
    jobId: job?.id,
    runId: job?.data?.runId,
    userId: job?.data?.userId,
    error: error.message,
    stack: error.stack,
  });
  Sentry.captureException(error, { tags: { worker: "resumeAgentV2" }, extra: { jobId: job?.id, runId: job?.data?.runId } });
});

export default worker;
