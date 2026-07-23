import { loadWorkspace, activateVersion } from "../services/workspace.service.js";
import { getVersion } from "../services/workspaceVersion.service.js";
import { getAnalysesForVersion, compareVersionAnalyses } from "../services/workspaceAnalysis.service.js";
import { listEvents } from "../services/workspaceEvent.service.js";
import { versionIdParamSchema, compareQuerySchema, eventsQuerySchema } from "../schemas/resumeWorkspace.schema.js";
import { getSuggestions } from "../services/suggestions.service.js";
import logger from "../logger/logger.js";

/**
 * GET /api/resume-workspace
 * Loads (or lazily creates) the user's workspace with all data.
 */
export const loadWorkspaceHandler = async (req, res, next) => {
  try {
    const payload = await loadWorkspace(req.userId, req.requestId);

    logger.info("Workspace loaded", {
      requestId: req.requestId,
      userId: req.userId,
      workspaceId: payload.workspace.id,
    });

    res.json({ success: true, ...payload });
  } catch (err) {
    next(err);
  }
};

/**
 * GET /api/resume-workspace/versions/:versionId
 * Gets a specific version with full snapshot and its analyses.
 */
export const getVersionHandler = async (req, res, next) => {
  try {
    const { versionId } = versionIdParamSchema.parse(req.params);

    const version = await getVersion(versionId);
    if (!version) {
      return res.status(404).json({ success: false, message: "Version not found" });
    }

    const analyses = await getAnalysesForVersion(versionId);

    res.json({
      success: true,
      version: {
        ...version,
        snapshotJson: version.snapshotJson ? JSON.parse(version.snapshotJson) : null,
      },
      analyses,
    });
  } catch (err) {
    next(err);
  }
};

/**
 * POST /api/resume-workspace/versions/:versionId/activate
 * Sets a version as the active workspace version.
 */
export const activateVersionHandler = async (req, res, next) => {
  try {
    const { versionId } = versionIdParamSchema.parse(req.params);
    const { workspaceId } = req.body;

    if (!workspaceId) {
      return res.status(400).json({ success: false, message: "workspaceId is required in request body" });
    }

    const result = await activateVersion(req.userId, workspaceId, versionId, req.requestId);

    res.json({
      success: true,
      message: `Version ${result.activeVersion.versionNumber} is now active`,
      activeVersion: result.activeVersion,
    });
  } catch (err) {
    next(err);
  }
};

/**
 * GET /api/resume-workspace/compare?versionA=uuid&versionB=uuid
 * Compares analyses across two versions.
 */
export const compareVersionsHandler = async (req, res, next) => {
  try {
    const { versionA, versionB } = compareQuerySchema.parse(req.query);

    const result = await compareVersionAnalyses(versionA, versionB);

    res.json({ success: true, ...result });
  } catch (err) {
    next(err);
  }
};

/**
 * GET /api/resume-workspace/events?limit=20&offset=0
 * Gets the workspace event timeline.
 */
export const listEventsHandler = async (req, res, next) => {
  try {
    const { limit, offset } = eventsQuerySchema.parse(req.query);

    // Need workspace ID — load workspace first
    const payload = await loadWorkspace(req.userId, req.requestId);
    const events = await listEvents(payload.workspace.id, limit, offset);

    res.json({
      success: true,
      events: events.map((e) => ({
        id: e.id,
        eventType: e.eventType,
        versionId: e.versionId,
        metadata: e.metadata ? JSON.parse(e.metadata) : null,
        createdAt: e.createdAt,
      })),
    });
  } catch (err) {
    next(err);
  }
};

/**
 * GET /api/resume-workspace/versions/:versionId/suggestions
 * Gets AI suggestions for a specific version.
 */
export const getSuggestionsHandler = async (req, res, next) => {
  try {
    const { versionId } = versionIdParamSchema.parse(req.params);
    const suggestions = await getSuggestions(versionId);
    res.json({ success: true, suggestions });
  } catch (err) {
    next(err);
  }
};
