import express from "express";
import { authMiddleware } from "../middleware/auth.js";
import { resumeEditHandler } from "../controllers/resumeEditor.controller.js";

const router = express.Router();

router.use(authMiddleware);

// POST /api/resume/edit/:versionId
router.post("/:versionId", resumeEditHandler);

export default router;
