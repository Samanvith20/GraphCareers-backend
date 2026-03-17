import logger from "../logger/logger.js";
import {
  upsertJobApplicationService,
  getUserJobApplicationsService,
} from "../services/jobApplication.service.js";

/**
 * POST /api/job-applications
 * Track or update a job application
 */
import { AppError } from "../lib/AppError.js";

export const upsertJobApplicationController = async (req, res, next) => {
  try {
    const userId = req.userId;

    if (!userId) {
      return next(new AppError("Unauthorized", 401));
    }

    const result = await upsertJobApplicationService({
      userId,
      ...req.body,
    });

    logger.info("Job application upsert success", {
      requestId: req.requestId,
      userId,
      jobUrl: req.body.jobUrl,
    });

    return res.json(result);

  } catch (err) {
    logger.error("upsertJobApplicationController error", {
      requestId: req.requestId,
      error: err.message,
      stack: err.stack,
    });

    next(err);
  }
};

/**
 * GET /api/job-applications
 * Get tracked jobs for logged-in user
 */
export const getUserJobApplicationsController = async (req, res, next) => {
  try {
    const userId = req.userId;

    if (!userId) {
      return next(new AppError("Unauthorized", 401));
    }

    const jobs = await getUserJobApplicationsService(userId);

    logger.info("User job applications fetched", {
      requestId: req.requestId,
      userId,
    });

    return res.json({ jobs });

  } catch (err) {
    logger.error("getUserJobApplicationsController error", {
      requestId: req.requestId,
      error: err.message,
      stack: err.stack,
    });

    next(err);
  }
};
