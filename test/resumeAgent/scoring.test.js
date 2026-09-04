import test from "node:test";
import assert from "node:assert/strict";
import { scoreResumeForTarget } from "../../src/modules/resumeAgent/domain/scoring.js";

const target = {
  requiredSkills: [{ name: "Java", importance: "required" }, { name: "Kubernetes", importance: "required" }],
  preferredSkills: [{ name: "AWS", importance: "preferred" }],
  responsibilities: ["Build scalable backend services"],
  keywords: ["Backend Engineer"],
  constraints: { minExperience: 3 },
};

function resume(skills) {
  return {
    contact: { name: "A Candidate", email: "a@example.com" },
    summary: "Backend engineer building reliable services for production systems.",
    skills: { technical: skills },
    experience: [{
      company: "Example Inc.",
      title: "Backend Engineer",
      experienceMonths: 48,
      bullets: ["Built scalable Java backend services and reduced latency by 30%."],
    }],
    education: [{ degree: "B.Tech", institution: "Example University" }],
  };
}

test("scoring exposes separate scores and increases when a verified target skill is present", () => {
  const before = scoreResumeForTarget(resume(["Java", "AWS"]), target, "manual_jd");
  const after = scoreResumeForTarget(resume(["Java", "AWS", "Kubernetes"]), target, "manual_jd");
  assert.ok(after.overall > before.overall);
  assert.equal(before.targetMatch.missingRequiredSkills[0], "Kubernetes");
  assert.deepEqual(after.targetMatch.missingRequiredSkills, []);
  assert.ok(Number.isInteger(after.atsCompatibility.score));
});

test("score is never presented as an unbounded value", () => {
  const result = scoreResumeForTarget(resume(["Java"]), target, "career_job");
  for (const value of [result.overall, result.atsCompatibility.score, result.targetMatch.score, result.resumeQuality.score]) {
    assert.ok(value >= 0 && value <= 100);
  }
});

