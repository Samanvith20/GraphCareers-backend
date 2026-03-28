import { db } from "../db/index.js";
import { jobMatches, users } from "../db/schema.js";


async function seed() {
  const user = await db.insert(users).values({
    email: "samanith2676@gmail.com",
    name: "Test User",
    skills: ["react", "node"],
    experience: 12,
  }).returning();

  await db.insert(jobMatches).values([
    {
      userId: user[0].id,
      jobSourceId: "job1",
      matchPercent: 85,
      score: 90,
    },
    {
      userId: user[0].id,
      jobSourceId: "job2",
      matchPercent: 80,
      score: 85,
    }
  ]);

  console.log("✅ Seed done");
}

//seed();