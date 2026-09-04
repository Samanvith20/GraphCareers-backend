import test from "node:test";
import assert from "node:assert/strict";
import { platformSourceAliases, rankPlatformJobCandidates } from "../../src/modules/resumeAgent/domain/platformSelection.js";

function job(index, overrides = {}) {
  return {
    sourceJobId: String(index),
    title: "Backend Developer",
    roleTitle: "Software Engineer - Backend",
    location: "Hyderabad",
    locationState: "Telangana",
    postedAt: new Date(Date.now() - index * 60_000).toISOString(),
    ...overrides,
  };
}

test("platform selection matches engineer/developer aliases and partial city locations", () => {
  const candidates = Array.from({ length: 12 }, (_, index) => job(index));
  const result = rankPlatformJobCandidates(candidates, {
    role: "Backend Engineer",
    location: "Hyderabad, Telangana",
    sampleSize: 10,
  });
  assert.equal(result.jobs.length, 10);
  assert.equal(result.metadata.locationApplied, true);
  assert.equal(result.metadata.locationFallback, false);
});

test("platform selection falls back to platform-wide role data when a location sample is too small", () => {
  const candidates = Array.from({ length: 10 }, (_, index) => job(index, {
    location: index < 2 ? "Hyderabad" : "Bengaluru",
    locationState: index < 2 ? "Telangana" : "Karnataka",
  }));
  const result = rankPlatformJobCandidates(candidates, {
    role: "Backend Engineer",
    location: "Hyderabad, Telangana",
    sampleSize: 10,
  });
  assert.equal(result.jobs.length, 10);
  assert.equal(result.metadata.locationApplied, false);
  assert.equal(result.metadata.locationFallback, true);
  assert.equal(result.metadata.locationCandidateCount, 2);
});

test("platform aliases support legacy Foundit and Monster source names", () => {
  assert.deepEqual(platformSourceAliases("Foundit"), ["foundit", "foundit.in", "monster", "monsterindia"]);
});
