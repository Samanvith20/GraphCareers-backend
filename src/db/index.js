// src/db/index.js
import "dotenv/config";
import { drizzle } from "drizzle-orm/node-postgres";
import pkg from "pg";
import * as schema from "./schema.js";

const { Pool } = pkg;

if (
  !process.env.DB_HOST ||
  !process.env.DB_PORT ||
  !process.env.DB_USER ||
  !process.env.DB_PASSWORD ||
  !process.env.DB_NAME
) {
  throw new Error("Missing database credentials");
}

// ✅ GLOBAL SINGLETON (ESM safe)
if (!globalThis.__pgPool) {
  console.log("🟢 Initializing Postgres pool");

  globalThis.__pgPool = new Pool({
    host: process.env.DB_HOST,
    port: Number(process.env.DB_PORT),
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME,
    ssl: false,
    max: 10,
    idleTimeoutMillis: 30000,
    connectionTimeoutMillis: 2000,
  });

  globalThis.__pgPool.on("error", (err) => {
    console.error("❌ Postgres pool error", err);
  });
}

export const pool = globalThis.__pgPool;
export const db = drizzle(pool, { schema });