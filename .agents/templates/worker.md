# BullMQ Worker Template

```javascript
import { Worker } from "bullmq";
import fs from "fs/promises";
import * as Sentry from "@sentry/node";
import { logger } from "../logger/logger.js";
import { redisConfig } from "../config/redis.js"; // Singleton Redis pool

export const createExampleWorker = () => {
  const worker = new Worker(
    "exampleQueue",
    async (job) => {
      const { requestId, filePath, payload } = job.data;
      logger.info("Starting background job", { requestId, jobId: job.id });

      try {
        // Asynchronous processing logic (e.g., parsing, AI extraction)
        if (filePath) {
          const fileBuffer = await fs.readFile(filePath);
        }
        
        return { success: true };
      } finally {
        // Mandatory cleanup to prevent /app/uploads volume exhaustion
        if (filePath) {
          await fs.unlink(filePath).catch(() => {});
        }
      }
    },
    {
      connection: redisConfig,
      concurrency: 5, // Explicitly capped to prevent container depletion
    }
  );

  worker.on("failed", (job, err) => {
    const requestId = job?.data?.requestId;
    logger.error("Worker job failed", { requestId, jobId: job?.id, error: err.message });
    Sentry.captureException(err, { tags: { requestId, queue: "exampleQueue" } });
  });

  return worker;
};
```
