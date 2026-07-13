import neo4j from "neo4j-driver";
import dotenv from "dotenv";

dotenv.config();

const NEO4J_URI = process.env.NEO4J_URI || "bolt://localhost:7687";
const NEO4J_USER = process.env.NEO4J_USER || "neo4j";
const NEO4J_PASSWORD = process.env.NEO4J_PASSWORD || "testpassword";

const driver = neo4j.driver(NEO4J_URI, neo4j.auth.basic(NEO4J_USER, NEO4J_PASSWORD));

async function deleteOldJobs() {
  const session = driver.session();
  try {
    console.log("Checking jobs created in the past 7 days...");
    const countQuery = `
      MATCH (j:Job) 
      WHERE j.created_at >= datetime() - duration({days: 7})
      RETURN count(j) AS count
    `;
    const countRes = await session.run(countQuery);
    const count = countRes.records[0].get("count").toNumber();
    console.log(`Found ${count} jobs from the past week.`);

    if (count === 0) {
      console.log("No jobs to delete.");
      return;
    }

    console.log("Deleting jobs in batches of 10,000 to prevent memory crashes...");
    const deleteQuery = `
      MATCH (j:Job) 
      WHERE j.created_at >= datetime() - duration({days: 7})
      WITH j LIMIT 10000
      DETACH DELETE j
      RETURN count(j) as deletedCount
    `;

    let totalDeleted = 0;
    while (true) {
      const res = await session.run(deleteQuery);
      const deleted = res.records[0].get("deletedCount").toNumber();
      if (deleted === 0) break;
      
      totalDeleted += deleted;
      console.log(`Deleted ${totalDeleted} / ${count} jobs so far...`);
    }

    console.log(`✅ Successfully completely deleted ${totalDeleted} jobs from Neo4j.`);
  } catch (error) {
    console.error("❌ Error deleting jobs:", error);
  } finally {
    await session.close();
    await driver.close();
  }
}

deleteOldJobs();
