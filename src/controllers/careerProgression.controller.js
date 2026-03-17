


import { getCareerInsightsService } from "../services/careerProgression.service.js";

import logger from "../logger/logger.js";


export async function getCareerProgression(req, res, next) {
  try {
    logger.info("Careerprogression controller started", {
      requestId: req.requestId,
      userId: req.userId,
    });

    const data = await getCareerInsightsService({
      userId: req.userId,
    });

    logger.info("careerprogression success", {
      requestId: req.requestId,
      userId: req.userId,
    });

    return res.json(data);

  } catch (err) {
    logger.error("careerprogression failure", {
      requestId: req.requestId,
      error: err.message,
      stack: err.stack,
    });

    next(err);
  }
}