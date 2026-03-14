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

    let { userId, buffer, fileType,filePath,requestId } = job.data;

    logger.info("Parsing resume for user:", {
        requestId,
        userId
    });

      try {

      buffer = await fs.readFile(filePath);

      let text = "";

      if (fileType === "pdf") {
        const result = await extractText(buffer);

        if (typeof result?.text === "string") {
          text = result.text;
        } else if (Array.isArray(result?.text)) {
          text = result.text.join(" ");
        }
      }

      if (fileType === "docx") {
        const parsed = await mammoth.extractRawText({ buffer });
        text = parsed.value;
      }

      text = text.trim().replace(/\s+/g, " ");

      if (!text || text.length < 50) {
        throw new Error("Resume parsing failed");
      }

      await db.update(resumes)
        .set({
          text,
          fileName: filePath,
          isResumeParsed: true
        })
        .where(eq(resumes.userId, userId));

    } finally {

      // cleanup file always
      try {
        await fs.unlink(filePath);
      } catch {
        console.warn("file already deleted:", filePath);
      }

    }
console.log("Pushing AI job", userId);


    // push to AI processing queue
    await resumeQueue.add("resumeAI", {
      userId,
      requestId,
    });

    console.log("Resume parsed successfully and pushed to AI queue:", userId);
  },
  {
    connection,
    concurrency: 4, // process 4 resumes simultaneously
  }
);