import { defineConfig } from "drizzle-kit";
import * as dotenv from "dotenv";

dotenv.config(); // REQUIRED for ESM
console.log(process.env.DATABASE_URL);
export default defineConfig({
  schema: "./src/db/schema.js",
  out: "./drizzle",
    dialect: "postgresql",
  dbCredentials: {
    url: process.env.DATABASE_URL,
  },
});
