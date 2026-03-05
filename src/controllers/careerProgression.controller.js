

import { eq } from "drizzle-orm";
import { getCareerInsightsService } from "../services/careerProgression.service.js";
import { db } from "../db/index.js";
import { users } from "../db/schema.js";
import logger from "../logger/logger.js";

export async function getCareerProgression(req, res) {
  try {
    logger.info("Careerprogression controller started",{
         requestId:req.requestId,
         userId:req.userId
    })
    const userId = req.userId; // coming from auth middleware

    if (!userId) {
      return res.status(401).json({ error: "Unauthorized" });
    }

    const user = await db.query.users.findFirst({
      where: eq(users.id, userId),
    });

    if (!user?.skills?.length) {
      return res
        .status(400)
        .json({ message: "Add your skills to see career progression" });
    }

    const data = await getCareerInsightsService({
      skills: user.skills,
      experienceMonths: user.experience || 0,
    });
    logger.info("careerprogression success",{
      requestId:req.requestId,
         userId:req.userId
    })

    return res.json(data);
  } catch (err) {
  logger.error("careerprogression failure",{
          requestId: req.requestId,
      error: err.message,
      stack: err.stack,
  })
    return res.status(500).json({
      error: "Failed to fetch career progression",
      details: err.message,
    });
  }
}