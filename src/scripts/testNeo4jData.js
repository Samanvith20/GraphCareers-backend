import "dotenv/config";
import neo4j from "neo4j-driver";
import { getNeo4jSession } from "../db/neo4j/session.js";
import { toNumber } from "../lib/utils.js";

async function testNeo4jData() {
  console.log("Starting Neo4j Data Verification...\n");
  const session = getNeo4jSession(neo4j.session.READ);

  try {
    // 1. Total Jobs
    const totalJobsRes = await session.run(`MATCH (j:Job) RETURN count(j) AS count`);
    console.log(`1. Total Jobs in Neo4j: ${toNumber(totalJobsRes.records[0].get("count"))}`);

    // 2. Jobs without any skills
    const jobsWithoutSkillsRes = await session.run(`
      MATCH (j:Job) 
      WHERE NOT (j)-[:REQUIRES]->(:Skill) 
      RETURN count(j) AS count
    `);
    console.log(`2. Jobs with ZERO mapped skills: ${toNumber(jobsWithoutSkillsRes.records[0].get("count"))}`);

    // 3. Average skills per job
    const avgSkillsRes = await session.run(`
      MATCH (j:Job)-[:REQUIRES]->(s:Skill)
      WITH j, count(s) AS skillCount
      RETURN avg(skillCount) AS avg, min(skillCount) AS min, max(skillCount) AS max
    `);
    if (avgSkillsRes.records.length > 0) {
      console.log(`3. Skill mapping stats per job (where skills > 0):`);
      console.log(`   - Average: ${avgSkillsRes.records[0].get("avg").toFixed(2)} skills`);
      console.log(`   - Min: ${toNumber(avgSkillsRes.records[0].get("min"))} skills`);
      console.log(`   - Max: ${toNumber(avgSkillsRes.records[0].get("max"))} skills`);
    }

    // 4. Sample Job Data
    console.log(`\n4. Sample Job Data Inspection (3 random jobs):`);
    const sampleJobsRes = await session.run(`
      MATCH (j:Job)
      OPTIONAL MATCH (j)-[:REQUIRES]->(s:Skill)
      WITH j, collect(s.canonical) AS skills
      RETURN j {.*} AS jobData, skills
      LIMIT 3
    `);
    
    sampleJobsRes.records.forEach((record, index) => {
      const jobData = record.get("jobData");
      const skills = record.get("skills");
      console.log(`\n--- Sample Job ${index + 1} ---`);
      console.log(`Title: ${jobData.title}`);
      console.log(`Company: ${jobData.company || "Unknown"}`);
      console.log(`Skills Mapped (${skills.length}): ${skills.join(", ") || "None"}`);
      console.log(`Raw Properties:`, Object.keys(jobData).join(", "));
    });

  } catch (err) {
    console.error("Error during Neo4j testing:", err);
  } finally {
    await session.close();
    console.log("\nNeo4j session closed. Verification complete.");
    process.exit(0);
  }
}

testNeo4jData();
