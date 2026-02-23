// src/db/index.js
import "dotenv/config";
import { drizzle } from "drizzle-orm/node-postgres";
import pkg from "pg";
import * as schema from "./schema.js";
const { Pool } = pkg;

if(!process.env.DB_HOST || !process.env.DB_PORT || !process.env.DB_USER || !process.env.DB_PASSWORD || !process.env.DB_NAME){
  throw new Error("Missing  database credentials");
}


export const pool = new Pool({
  host: process.env.DB_HOST,
  port: Number(process.env.DB_PORT),
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD, 
  database: process.env.DB_NAME,
  ssl: false, // 🔴 FORCE OFF
  
});

pool.on("connect", () => {
  console.log("✅ Postgres connected");
});

pool.on("error", (err) => {
  console.error("❌ Postgres pool error", err);
});

export const db = drizzle(pool,{schema});