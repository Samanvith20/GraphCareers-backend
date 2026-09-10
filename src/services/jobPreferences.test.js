import test from "node:test";
import assert from "node:assert/strict";
import { emptyJobPreferences, getFeedContext, jobPreferencesSchema } from "../schemas/jobPreferences.schema.js";
import { browseQueries, preferenceWhere } from "./jobFeedQuery.js";

test("no profile information produces exploration, not a match score", () => {
  const feed = getFeedContext({});
  assert.equal(feed.mode, "explore");
  assert.equal(feed.hasSkills, false);
  assert.equal(feed.experienceKnown, false);
  assert.equal(feed.unanswered.length, 4);
});
test("skills without preferences remain profile suggestions", () => {
  const feed = getFeedContext({ skills: ["Node.js"], experience: 16 });
  assert.equal(feed.mode, "profile");
  assert.equal(feed.experienceKnown, true);
});
test("role alone supports a role feed", () => {
  assert.equal(getFeedContext({}, { desiredRoles: ["backend developer"] }).mode, "role");
});
test("zero experience is known; missing/invalid experience is unknown", () => {
  assert.equal(getFeedContext({ experience: 0 }).experienceKnown, true);
  for (const experience of [null, undefined, NaN, -1, "0"]) {
    assert.equal(getFeedContext({ experience }).experienceKnown, false);
  }
});
test("blank/invalid skills do not fabricate personalization", () => {
  for (const skills of [null, [], [" "], [null], {}]) assert.equal(getFeedContext({ skills }).hasSkills, false);
});
test("unanswered and explicitly any remain distinct", () => {
  const unknown = jobPreferencesSchema.parse({ locations: null });
  const any = jobPreferencesSchema.parse({ locations: [] });
  assert.equal(unknown.locations, null);
  assert.deepEqual(any.locations, []);
  assert.ok(getFeedContext({}, unknown).unanswered.includes("locations"));
  assert.ok(!getFeedContext({}, any).unanswered.includes("locations"));
});
test("partial saves preserve omitted fields and normalize role/location values", () => {
  const patch = jobPreferencesSchema.parse({ desiredRoles: [" Backend Developer ", "backend developer"] });
  assert.deepEqual(patch, { desiredRoles: ["backend developer"] });
  assert.deepEqual({ ...emptyJobPreferences, ...patch }.locations, null);
});
test("invalid and unexpected input is rejected", () => {
  for (const value of [{}, { userId: "another-user" }, { workModes: ["random"] }, { locations: [""] }, { desiredRoles: Array(11).fill("a") }]) {
    assert.equal(jobPreferencesSchema.safeParse(value).success, false);
  }
});
test("browse count and list use identical preference restrictions and stable paging", () => {
  const { stats, jobs } = browseQueries(preferenceWhere);
  assert.ok(stats.includes(preferenceWhere));
  assert.ok(jobs.includes(preferenceWhere));
  assert.match(jobs, /null AS matchPercent/);
  assert.match(jobs, /j.posted_at DESC, j.job_id ASC SKIP \$skip LIMIT \$limit/);
  assert.match(jobs, /\$experienceKnown = false/);
  assert.match(jobs, /\[\] AS missingSkills/);
});
