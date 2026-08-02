import express from "express";
import { authMiddleware } from "../middleware/auth.js";
import { jdOptimizeHandler } from "../controllers/jdOptimization.controller.js";

const router = express.Router();

router.use(authMiddleware);

// POST /api/resume/jd-optimize/:versionId
router.post("/:versionId", jdOptimizeHandler);

export default router;
