import test from "node:test";
import assert from "node:assert/strict";
import { buildExactTarget, buildPlatformTarget, targetFingerprint } from "../../src/modules/resumeAgent/domain/target.js";

test("platform target weights relevant recent job skills and reports sample confidence", () => {
  const jobs = Array.from({ length: 20 }, (_, index) => ({
    title: "Java Backend Developer",
    roleTitle: "Backend Developer",
    postedAt: new Date(Date.now() - index * 86_400_000),
    skillsTechnical: index < 18 ? ["Java", "Spring Boot"] : ["Java"],
    skillsTools: index < 10 ? ["Docker"] : [],
    description: "Build REST microservices using PostgreSQL.",
    minExp: 3,
  }));
  const target = buildPlatformTarget({ platform: "naukri", role: "Java Backend Developer", jobs });
  assert.equal(target.market.sampleSize, 20);
  assert.equal(target.analysisConfidence, "medium");
  assert.ok(target.requiredSkills.some((skill) => skill.name === "Java"));
  assert.ok(target.requiredSkills.some((skill) => skill.name === "Spring Boot"));
  assert.equal(target.constraints.minExperience, 3);
});

test("exact target does not invent unknown skills", () => {
  const target = buildExactTarget({
    type: "manual_jd",
    jobTitle: "Backend Engineer",
    companyName: "Example",
    jobDescription: "Required: Java and Spring Boot. You will build REST services.",
  });
  assert.ok(target.requiredSkills.some((skill) => skill.name === "Java"));
  assert.ok(!target.requiredSkills.some((skill) => skill.name === "Kubernetes"));
});

test("target fingerprints are stable across object key order", () => {
  assert.equal(targetFingerprint({ a: 1, b: 2 }), targetFingerprint({ b: 2, a: 1 }));
});

test("platform target removes noisy fragments and canonicalizes composite graph skills", () => {
  const jobs = Array.from({ length: 10 }, () => ({
    title: "Backend Developer",
    roleTitle: "Backend Developer",
    postedAt: new Date(),
    skillsTechnical: ["boot", "development", "java development", "postgresql & jpa/hibernate", "fast api"],
    skillsTools: [],
    minExp: 2,
  }));
  const target = buildPlatformTarget({ platform: "naukri", role: "Backend Engineer", jobs });
  const names = [...target.requiredSkills, ...target.preferredSkills].map((skill) => skill.name);
  assert.ok(names.includes("Java"));
  assert.ok(names.includes("PostgreSQL"));
  assert.ok(names.includes("JPA"));
  assert.ok(names.includes("Hibernate"));
  assert.ok(names.includes("FastAPI"));
  assert.ok(!names.includes("boot"));
  assert.ok(!names.includes("development"));
});

test("platform target does not treat a missing minimum experience as zero years", () => {
  const target = buildPlatformTarget({
    platform: "naukri",
    role: "Backend Engineer",
    jobs: [
      { title: "Backend Engineer", roleTitle: "Backend Engineer", skillsTechnical: ["Java"], minExp: null },
      { title: "Backend Engineer", roleTitle: "Backend Engineer", skillsTechnical: ["Java"], minExp: 4 },
    ],
  });
  assert.equal(target.constraints.minExperience, 4);
});
