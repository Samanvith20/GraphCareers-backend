import neo4j from "neo4j-driver";

if (!process.env.NEO4J_URI) {
  throw new Error("NEO4J_URI is not defined");
}

export const neo4jDriver = neo4j.driver(
  process.env.NEO4J_URI,
  neo4j.auth.basic(
    process.env.NEO4J_USER,
    process.env.NEO4J_PASSWORD
  ),
);