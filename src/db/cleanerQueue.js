import { Queue } from "bullmq";
import { connection } from "../queue/connection.js";
import logger from "../logger/logger.js";


const queue = new Queue('"resumeParseQueue"', { connection});

/**
 * Purges the 'naukri-http-requests' queue and terminates the process.
 *
 * Performs a full cleanup of the queue by removing waiting and active jobs, deleting completed and failed jobs, obliterating the queue, and then exits the process with code 0.
 */
async function clearQueue() {
  logger.info('Cleaning BullMQ queue...');

  await queue.drain(true); // removes ALL waiting + active jobs
  await queue.clean(0, 'completed'); // remove completed
  await queue.clean(0, 'failed'); // remove failed
  await queue.obliterate({ force: true }); // completely delete queue

  logger.info('Queue cleared successfully');
  process.exit(0);
}

clearQueue();