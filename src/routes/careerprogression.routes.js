import { Router } from "express";
import { authMiddleware } from "../middleware/auth.js";
import { getCareerProgression } from "../controllers/careerProgression.controller.js";

const router=Router()

router.post("/",authMiddleware,getCareerProgression)

export default router