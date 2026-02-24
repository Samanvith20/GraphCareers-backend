import { Router } from "express";
import { getMatchedJobs } from "../controllers/jobs.controller.js";
import { authMiddleware } from "../middleware/auth.js";

const router = Router();
router.get("/", authMiddleware, getMatchedJobs);
export default router;
