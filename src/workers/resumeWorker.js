import "../config/env.js";
import { Worker } from "bullmq";
import { parseResumeWithAIService } from "../services/user.service.js";
import { connection } from "../queue/connection.js";
import logger from "../logger/logger.js";

logger.info("Resume worker started");

new Worker(
  "resumeParseQueue",
  async (job) => {

    const { userId, requestId } = job.data;

    logger.info("Resume parsing started", {
      requestId,
      userId
    });

    await parseResumeWithAIService(userId,requestId);

    logger.info("Resume parsing completed", {
      requestId,
      userId
    });

  },
  { connection,
    concurrency:4
   }
);