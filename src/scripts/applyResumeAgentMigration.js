import "dotenv/config";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { pool } from "../db/index.js";
import logger from "../logger/logger.js";

const currentDir = path.dirname(fileURLToPath(import.meta.url));
const migrationPath = path.resolve(currentDir, "../../drizzle/0001_resume_agent_v2.sql");

try {
  const sql = await fs.readFile(migrationPath, "utf8");
  await pool.query("BEGIN");
  await pool.query(sql);
  await pool.query("COMMIT");
  logger.info("Resume Agent v2 database migration applied", { migrationPath });
} catch (error) {
  await pool.query("ROLLBACK").catch(() => {});
  logger.error("Resume Agent v2 database migration failed", { migrationPath, error: error.message, stack: error.stack });
  process.exitCode = 1;
} finally {
  await pool.end();
}

