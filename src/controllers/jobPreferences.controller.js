import neo4j from "neo4j-driver";
import { getNeo4jSession } from "../db/neo4j/session.js";
import { getJobPreferences, saveJobPreferences } from "../services/jobPreferences.service.js";
import { jobPreferencesSchema } from "../schemas/jobPreferences.schema.js";
import { AppError } from "../lib/AppError.js";

export async function readPreferences(req, res, next) {
  try { res.json({ preferences: await getJobPreferences(req.userId) }); }
  catch (error) { next(error); }
}

export async function updatePreferences(req, res, next) {
  try {
    const parsed = jobPreferencesSchema.safeParse(req.body);
    if (!parsed.success) throw new AppError(parsed.error.issues[0]?.message || "Invalid preferences", 400);
    res.json({ preferences: await saveJobPreferences(req.userId, parsed.data) });
  } catch (error) { next(error); }
}

export async function listJobRoles(req, res, next) {
  const session = getNeo4jSession(neo4j.session.READ);
  try {
    const query = typeof req.query.q === "string" ? req.query.q.trim().toLowerCase().slice(0, 100) : "";
    const result = await session.run(`
      MATCH (j:Job)-[:MAPS_TO]->(r:Role)
      WHERE j.posted_at >= datetime() - duration('P3D') AND j.expires_at > datetime()
        AND r.role_title IS NOT NULL AND toLower(r.role_title) CONTAINS $query
      RETURN DISTINCT toLower(trim(r.role_title)) AS role ORDER BY role LIMIT 100
    `, { query }, { timeout: 10000 });
    res.json({ roles: result.records.map(record => record.get("role")).filter(Boolean) });
  } catch (error) { next(error); }
  finally { await session.close(); }
}
