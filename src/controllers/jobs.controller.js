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
   

    return res.json(data);
  } catch (err) {
    console.error("Job matching error:", err);
    return res.status(500).json({
      error: "Failed to fetch jobs",
    });
  }
}