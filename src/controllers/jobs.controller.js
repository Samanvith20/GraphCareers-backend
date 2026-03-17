import logger from "../logger/logger.js";
import { getMatchedJobsService } from "../services/jobs.service.js";


export async function getMatchedJobs(req, res,next) {
  try {
    const userId = req.userId; // 👈 from auth middleware
   

    const data = await getMatchedJobsService({
      userId,
     
    });
       logger.info("Matched jobs fetched", {
      requestId: req.requestId,
      userId,
    });


    return res.json(data);
  } catch (err) {
    logger.error("Job matching error:", {
      requestId: req.requestId,
      error: err.message,
      stack: err.stack,
    });
    next(err);
  }
}