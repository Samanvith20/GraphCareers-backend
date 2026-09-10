import test, { mock } from "node:test";
import assert from "node:assert/strict";

let user = { id: "test-user", skills: [], experience: null, tier: "free" };
let preferences = {};
let failQuery = false;
const calls = [];
let closes = 0;
let writes = 0;
const record = values => ({ get: key => values[key] });
mock.module("../db/index.js", { namedExports: { db: {
  query: { users: { findFirst: async () => user } },
  transaction: async () => { writes += 1; },
} } });
mock.module("./jobPreferences.service.js", { namedExports: { getJobPreferences: async () => preferences } });
mock.module("../db/neo4j/session.js", { namedExports: { getNeo4jSession: () => ({
  close: async () => { closes += 1; },
  run: async (query, params) => {
    calls.push({ query, params });
    if (failQuery) throw new Error("Graph unavailable");
    if (query.includes("AS totalJobs")) return { records: [record({ totalJobs: 1, avgMatch: 0, perfectMatches: 0, newJobs: 1 })] };
    return { records: [record({
      jobId: "job-1", title: "Backend developer", postedAt: new Date().toISOString(),
      company: "Example", location: null, matchPercent: user.skills.length ? 50 : null,
      matchedSkills: [], missingSkills: [], requiredSkills: ["node.js"],
      matchedCount: 0, totalRequired: 1, minExp: 1, maxExp: 2, qualityScore: 0,
    })] };
  },
}) } });
const { getMatchedJobsService } = await import("./jobs.service.js");

test("browse response has neutral requirements, unknown location, no score or recommendation writes", async () => {
  const result = await getMatchedJobsService({ userId: user.id });
  assert.equal(result.feed.mode, "explore");
  assert.equal(result.jobs[0].matchPercent, null);
  assert.equal(result.jobs[0].location, "Location not provided");
  assert.deepEqual(result.jobs[0].requiredSkills, ["node.js"]);
  assert.deepEqual(result.jobs[0].missingSkills, []);
  assert.equal(calls[0].params.experienceKnown, false);
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(writes, 0);
  assert.equal(closes, 1);
});
test("role-only selection is parameterized and filters both queries", async () => {
  calls.length = 0;
  preferences = { desiredRoles: ["backend developer"], locations: ["hyderabad"], workModes: ["remote"] };
  const result = await getMatchedJobsService({ userId: user.id });
  assert.equal(result.feed.mode, "role");
  for (const call of calls) {
    assert.deepEqual(call.params.desiredRoles, preferences.desiredRoles);
    assert.deepEqual(call.params.locations, ["hyderabad"]);
    assert.match(call.query, /preferredRole.role_title/);
    assert.ok(!call.query.includes("hyderabad"));
  }
});
test("profile path still scores skills, expands aliases, and does not invent experience", async () => {
  calls.length = 0;
  user = { ...user, skills: ["reactjs"] };
  const result = await getMatchedJobsService({ userId: user.id, page: 2 });
  assert.equal(result.feed.mode, "profile");
  assert.equal(result.jobs[0].matchPercent, 50);
  assert.ok(calls[0].params.skillVariants.includes("react"));
  assert.equal(calls[0].params.experienceKnown, false);
  assert.match(calls[1].query, /\$experienceKnown = false/);
});
test("graph errors propagate and the session still closes", async () => {
  const previous = closes;
  failQuery = true;
  await assert.rejects(getMatchedJobsService({ userId: user.id }), /Graph unavailable/);
  assert.equal(closes, previous + 1);
});
