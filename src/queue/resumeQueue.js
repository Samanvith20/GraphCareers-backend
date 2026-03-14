import { Queue } from "bullmq"
import { connection } from "./connection.js";

export const resumeQueue = new Queue("resumeParseQueue", {
  connection,
});