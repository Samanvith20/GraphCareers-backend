// src/db/index.js
import "dotenv/config";
import { drizzle } from "drizzle-orm/node-postgres";
import pkg from "pg";

const { Pool } = pkg;

if (!process.env.DATABASE_URL) {
  throw new Error("DATABASE_URL is missing at runtime");
}

export const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: {
    rejectUnauthorized: false, // 🔥 REQUIRED for Neon
  },
});

pool.on("connect", () => {
  console.log("✅ Postgres connected");
});

pool.on("error", (err) => {
  console.error("❌ Postgres pool error", err);
});

export const db = drizzle(pool);