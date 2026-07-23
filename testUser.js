import { db } from "./src/db/index.js";
import { users } from "./src/db/schema.js";
import { eq } from "drizzle-orm";
import { executePlatformOptimization } from "./src/orchestrators/resume.orchestrator.js";
import fs from "fs";

async function run() {
  try {
    console.log("Looking up user...");
    const [user] = await db.select().from(users).where(eq(users.email, "samanvith2005@gmail.com"));
    if (!user) {
      console.log("User not found!");
      process.exit(1);
    }
    console.log(`Found user ID: ${user.id}`);
    
    console.log("Starting execution (bypassing BullMQ worker to test logic synchronously)...");
    const result = await executePlatformOptimization(user.id, "naukri", "test-req-" + Date.now());
    
    console.log("Execution complete!");
    console.log(JSON.stringify(result, null, 2));
    fs.writeFileSync("optimization_test_log.json", JSON.stringify(result, null, 2));
    
    process.exit(0);
  } catch (err) {
    console.error("Error during execution:");
    console.error(err);
    fs.writeFileSync("optimization_test_error.log", err.stack || err.message);
    process.exit(1);
  }
}

run();
