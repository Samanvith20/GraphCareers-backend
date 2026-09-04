import "dotenv/config";
import neo4j from "neo4j-driver";
import { getNeo4jSession } from "../db/neo4j/session.js";
import { neo4jDriver } from "../db/neo4j/driver.js";
import logger from "../logger/logger.js";

const statements = [
  "CREATE INDEX resume_agent_job_source IF NOT EXISTS FOR (j:Job) ON (j.source_normalized)",
  "CREATE INDEX resume_agent_job_expiry IF NOT EXISTS FOR (j:Job) ON (j.expires_at)",
  "CREATE INDEX resume_agent_job_posted IF NOT EXISTS FOR (j:Job) ON (j.posted_at)",
  "CREATE INDEX resume_agent_role_normalized IF NOT EXISTS FOR (r:Role) ON (r.role_normalized)",
  `
    MATCH (j:Job)
    WHERE j.source IS NOT NULL
    SET j.source_normalized = toLower(trim(j.source))
    RETURN count(j) AS updatedJobs
  `,
  `
    MATCH (r:Role)
    WHERE r.role_title IS NOT NULL
    SET r.role_normalized = toLower(trim(r.role_title))
    RETURN count(r) AS updatedRoles
  `,
];

const session = getNeo4jSession(neo4j.session.WRITE);
try {
  for (const statement of statements) {
    const result = await session.run(statement, {}, { timeout: 120_000 });
    const summary = result.records[0]?.toObject?.() || {};
    logger.info("Resume Agent graph preparation step completed", { summary });
  }
  logger.info("Resume Agent Neo4j indexes and normalized properties are ready");
} catch (error) {
  logger.error("Resume Agent graph preparation failed", { error: error.message, stack: error.stack });
  process.exitCode = 1;
} finally {
  await session.close();
  await neo4jDriver.close();
}
