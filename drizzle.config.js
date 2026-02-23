import { defineConfig } from "drizzle-kit";
import * as dotenv from "dotenv";

dotenv.config(); // REQUIRED for ESM

export default defineConfig({
  schema: "./src/db/schema.js",
  out: "./drizzle",
    dialect: "postgresql",
  dbCredentials: {
    host: process.env.DB_HOST,
  port: Number(process.env.DB_PORT),
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME,
  ssl:false
  },
});
