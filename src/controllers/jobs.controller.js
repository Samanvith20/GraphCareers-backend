import { db } from "../db/index.js";
import { jobs } from "../db/schema.js";
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
export async function ingestJobsBatch(req, res, next) {
  try {
    const jobsInput = req.body.jobs;

    if (!jobsInput?.length) {
      return res.status(400).json({ error: "No jobs provided" });
    }

    // 🔥 transform data
    const values = jobsInput.map((job) => ({
      sourceJobId: job.job_id,
      source: job.source,
      sourceUrl: job.source_url,

      title: job.job_title,
      roleTitle: job.role_title,
      company: job.company_name,

      skillsTechnical: job.skills?.technical || [],
      skillsTools: job.skills?.tools || [],
      skillsSoft: job.skills?.soft || [],

      minExp: job.min_experience,
      maxExp: job.max_experience,
      difficultyLevel: job.difficulty_level,

      salaryMin: job.salary_min,
      salaryMax: job.salary_max,
      salaryCurrency: job.salary_currency,
      salaryPeriod: job.salary_period,

      location: job.location,
      locationState: job.location_state,
      locationCountry: job.location_country,

      jobType: job.job_type,
      workMode: job.work_mode,

      industry: job.industry || [],
      description: job.description,

      postedAt: job.posted_at ? new Date(job.posted_at) : null,
      expiryAt: job.expiry_at ? new Date(job.expiry_at) : null,
    }));

    // 🔥 UPSERT (CRITICAL)
    const inserted = await db
      .insert(jobs)
      .values(values)
      .returning({ id: jobs.sourceJobId });

    const successIds = inserted.map((j) => j.id);

    logger.info("Job batch ingested", {
      requestId: req.requestId,
      count: successIds.length,
    });

    res.json({ success: true, successIds });
  } catch (err) {
    logger.error("Job batch ingest failed", {
      requestId: req.requestId,
      name:    err.name,
      message: err.message,
    });
    next(err);
  }
}
