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

new Worker(
  "resume-parse",
  async (job) => {
    const { userId, fileType, filePath, fileName, requestId } = job.data;

    logger.info("Parsing resume for user", { userId, requestId });

    try {
      await db
        .update(resumes)
        .set({
          pendingFileName: fileName,
          status: "processing",
        })
        .where(eq(resumes.userId, userId));

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
        throw new Error("Resume parsing failed");
      }

      // await db.update(resumes)
      //   .set({
      //     text,
      //     fileName,
      //     status: "completed",
      //     isResumeParsed: true,
      //     errorMessage: null
      //   })
      //   .where(eq(resumes.userId, userId));

      logger.info("Pushing job to AI queue", { userId, requestId });

      await resumeQueue.add("resumeAI", {
        userId,
        requestId,
      });

      logger.info("Job pushed to AI queue", {
        userId,
        requestId,
      });
    } catch (err) {
      await db
        .update(resumes)
        .set({
          status: "failed",
          errorMessage: err.message,
        })
        .where(eq(resumes.userId, userId));

      logger.error("Resume parsing failed", {
        error: err.message,
        userId,
        requestId,
      });
    } finally {
      try {
        await fs.unlink(filePath);
      } catch {
        console.warn("already deleted file", filePath);
      }
    }
  },
  { connection, concurrency: 1 },
);
