import {
  upsertJobApplicationService,
  getUserJobApplicationsService,
} from "../services/jobApplication.service.js";

/**
 * POST /api/job-applications
 * Track or update a job application
 */
export const upsertJobApplicationController = async (req, res) => {
  try {
    const userId = req.userId;

    if (!userId) {
      return res.status(401).json({ error: "Unauthorized" });
    }

    await upsertJobApplicationService({
      userId,
      ...req.body,
    });

    return res.json({ success: true });
  } catch (err) {
    console.error("upsertJobApplicationController error:", err);
    return res.status(500).json({ error: "Internal server error" });
  }
};

/**
 * GET /api/job-applications
 * Get tracked jobs for logged-in user
 */
export const getUserJobApplicationsController = async (req, res) => {
  try {
    const userId = req.userId
   

    if (!userId) {
      return res.status(401).json({ error: "Unauthorized" });
    }

    const jobs = await getUserJobApplicationsService(userId);

    return res.json({ jobs });
  } catch (err) {
    console.error("getUserJobApplicationsController error:", err);
    return res.status(500).json({ error: "Internal server error" });
  }
};
