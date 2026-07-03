import { getCareerInsightsService } from "../services/careerProgression.service.js";
import logger from "../logger/logger.js";

export async function getCareerProgression(req, res, next) {
  try {
    const data = await getCareerInsightsService({
      userId: req.userId,
    });

    return res.json(data);
  } catch (err) {
    next(err);
  }
}