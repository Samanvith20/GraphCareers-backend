import { Queue } from "bullmq";
import { connection } from "../../queue/connection.js";

export const resumeAgentQueue = new Queue("resumeAgentV2", {
  connection,
  defaultJobOptions: {
    attempts: 3,
    backoff: { type: "exponential", delay: 1500 },
    removeOnComplete: { age: 3600, count: 1000 },
    removeOnFail: { age: 604800, count: 5000 },
  },
});

export async function enqueueResumeAgentRun({ runId, userId, requestId }) {
  return resumeAgentQueue.add(
    "processRun",
    { runId, userId, requestId },
    { jobId: runId },
  );
}

