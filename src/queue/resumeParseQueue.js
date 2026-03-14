import { Queue } from "bullmq";
import { connection } from "./connection.js";

export const resumeParseQueue = new Queue("resume-parse", {
  connection,
});