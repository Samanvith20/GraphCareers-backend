

import { neo4jDriver } from "./driver.js";
import neo4j from "neo4j-driver";

export function getNeo4jSession(
  mode = neo4j.session.WRITE
) {
  return neo4jDriver.session({ defaultAccessMode: mode });
}