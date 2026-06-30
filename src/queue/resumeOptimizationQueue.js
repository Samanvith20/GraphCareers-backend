import { Queue } from "bullmq";
import { connection } from "./connection.js";

/**
 * Queue for targeted resume optimization jobs.
 * One job per (userId, jobSourceId) pair.
 */
export const resumeOptimizationQueue = new Queue("resumeOptimization", {
  connection,
  defaultJobOptions: {
    removeOnComplete: true,
    removeOnFail: false,
    attempts: 2,
    backoff: {
      type: "exponential",
      delay: 5000, 
    },
  },
});
