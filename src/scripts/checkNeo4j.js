import { getNeo4jSession } from "../db/neo4j/session.js";
import neo4j from "neo4j-driver";
import { config } from "dotenv";
config();

async function check() {
  const session = getNeo4jSession(neo4j.session.READ);
  try {
    const res = await session.run(`
      MATCH (j:Job)
      RETURN j.source AS source, count(j) AS count
      ORDER BY count DESC
    `);
    console.log("Job Counts by Source:");
    res.records.forEach(r => console.log(`${r.get('source')}: ${r.get('count')}`));

    const roleRes = await session.run(`
      MATCH (j:Job)-[:MAPS_TO]->(r:Role)
      RETURN r.role_title AS role, count(j) AS count
      ORDER BY count DESC LIMIT 10
    `);
    console.log("\nTop Roles in Jobs:");
    roleRes.records.forEach(r => console.log(`${r.get('role')}: ${r.get('count')}`));

    const matchRes = await session.run(`
      MATCH (j:Job)-[:REQUIRES]->(s:Skill) 
      
      RETURN count(s) as skill_rels
    `);
    console.log("\nJob-Skill relationships:", matchRes.records[0].get('skill_rels'));

  } catch (err) {
    console.error("Error:", err);
  } finally {
    await session.close();
    process.exit(0);
  }
}

check();
