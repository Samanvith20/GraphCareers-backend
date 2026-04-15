import "../config/env.js";
import { Worker } from "bullmq";
import { parseResumeWithAIService } from "../services/user.service.js";
import { connection } from "../queue/connection.js";
import logger from "../logger/logger.js";
import Sentry from "../lib/sentry.js";

logger.info("Resume worker started");

const worker=new Worker(
  "resumeParseQueue",
  async (job) => {

    const { userId, requestId } = job.data;
   Sentry.setTag("requestId", requestId);
    Sentry.setContext("job", {
      jobId: job.id,
      userId,
    });
   

    await parseResumeWithAIService(userId,requestId);

    logger.info("Resume parsing completed", {
      requestId,
      userId
    });

  },
  { connection,
    concurrency:2
   }
);
worker.on("failed", (job, err) => {
  Sentry.captureException(err, {
    extra: {
      jobId: job.id,
      userId: job.data.userId,
      requestId: job.data.requestId, // 👈 pass this when adding job
    },
  });
});