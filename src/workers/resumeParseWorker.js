import { Worker } from "bullmq";
import { connection } from "../queue/connection.js";
import "../config/env.js";
import mammoth from "mammoth";
import { extractText } from "unpdf";

import { db } from "../db/index.js";
import { resumes } from "../db/schema.js";
import { eq } from "drizzle-orm";

import { resumeQueue } from "../queue/resumeQueue.js";
import logger from "../logger/logger.js";
import fs from "fs/promises";
import Sentry from "../lib/sentry.js";

const worker=new Worker(
  "resume-parse",
  async (job) => {
    const { userId, fileType, filePath, fileName, requestId } = job.data;
Sentry.setTag("requestId", requestId);
    Sentry.setContext("job", {
      jobId: job.id,
      userId,
    });
    logger.info("Parsing resume for user", { userId, requestId });

    try {
      const buffer = await fs.readFile(filePath);

      let text = "";

      if (fileType === "pdf") {
        const result = await extractText(new Uint8Array(buffer));
        text = Array.isArray(result.text) ? result.text.join(" ") : result.text;
      }

      if (fileType === "docx") {
        const parsed = await mammoth.extractRawText({ buffer });
        text = parsed.value;
      }

      text = text.trim().replace(/\s+/g, " ");

      if (!text || text.length < 50) {
        throw new Error("Resume text extraction failed or too short");
      }

      // ✅ One query — creates row if missing, updates if exists
      await db.insert(resumes)
        .values({
          userId,
          text,
          pendingFileName: fileName,
          status: "processing",
          isResumeParsed: false,
          errorMessage: null,
        })
        .onConflictDoUpdate({
          target: resumes.userId,
          set: {
            text,
            pendingFileName: fileName,
            status: "processing",
            errorMessage: null,
          }
        });

      logger.info("Pushing job to AI queue", { userId, requestId },
          { jobId: userId }

      );

      await resumeQueue.add("resumeAI", { userId, requestId });

      logger.info("Job pushed to AI queue", { userId, requestId });

    } catch (err) {
      // ✅ Also upsert here — catch block same problem if row doesn't exist
      try {
        await db.insert(resumes)
          .values({
            userId,
            status: "failed",
            errorMessage: err.message,
          })
          .onConflictDoUpdate({
            target: resumes.userId,
            set: {
              status: "failed",
              errorMessage: err.message,
            }
          });
      } catch (dbErr) {
        logger.error("Failed to update failed status", {
          userId,
          dbError: dbErr.message
        });
      }

      logger.error("Resume parsing failed", {
        error: err.message,
        userId,
        requestId,
      });
    } finally {
      try {
        await fs.unlink(filePath);
      } catch {
        console.warn("Already deleted:", filePath);
      }
    }
  },
  { connection, concurrency: 2},

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


