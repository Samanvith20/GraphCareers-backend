import { db } from "../db/index.js";
import { jobMatches, users } from "../db/schema.js";
import { eq } from "drizzle-orm";

async function seed() {

  let existingUser = await db
    .select()
    .from(users)
    .where(eq(users.email, "samanith2676@gmail.com"));

  let user;

  if (existingUser.length > 0) {
    user = existingUser[0];
    // console.log("✅ Using existing user:", user.id);
  } else {
    const newUser = await db.insert(users).values({
      email: "samanith2676@gmail.com",
      name: "Test User",
      skills: ["react", "node"],
      experience: 12,
    }).returning();

    user = newUser[0];
    console.log("✅ Created new user:", user.id);
  }

  // Add jobs for testing
  await db.insert(jobMatches).values([
   
    {
      userId: user.id,
      jobSourceId: "job23",
      matchPercent: 80,
      score: 85,
    },
    {
      userId: user.id,
      jobSourceId: "job34",
      matchPercent: 92,
      score: 95,
    }
  ]);

  console.log("✅ Jobs added for user");
}

//seed();