import express from "express";
import {
  loadWorkspaceHandler,
  getVersionHandler,
  activateVersionHandler,
  compareVersionsHandler,
  listEventsHandler,
  getSuggestionsHandler,
} from "../controllers/resumeWorkspace.controller.js";
import { authMiddleware } from "../middleware/auth.js";

const router = express.Router();

router.use(authMiddleware);

// Load (or lazily create) the user's workspace
router.get("/", loadWorkspaceHandler);

// Get a specific version with full snapshot + analyses
router.get("/versions/:versionId", getVersionHandler);

// Activate a specific version
router.post("/versions/:versionId/activate", activateVersionHandler);

// Compare two versions' analyses
router.get("/compare", compareVersionsHandler);

// Get workspace event timeline
router.get("/events", listEventsHandler);

// Get AI suggestions for a version
router.get("/versions/:versionId/suggestions", getSuggestionsHandler);

export default router;
