import logger from "../logger/logger.js";
import { getMatchedJobsService } from "../services/jobs.service.js";


export async function getMatchedJobs(req, res) {
  try {
    const userId = req.userId; // 👈 from auth middleware
    let workMode=null;
    let jobType=null;
    let maxExperience=null;

    const data = await getMatchedJobsService({
      userId,
      workMode,
      jobType,
      maxExperience,
    });
      logger.info("getmatchedJobs::",{
        requestId:req.requestId,
        userId:req.userId
      })

    return res.json(data);
  } catch (err) {
    logger.error("Job matching error:", {
      requestId: req.requestId,
      error: err.message,
      stack: err.stack,
    });
    return res.status(500).json({
      error: "Failed to fetch jobs",
    });
  }
}