import test from "node:test";
import assert from "node:assert/strict";
import { buildVerifiedFacts, validateProposedChange } from "../../src/modules/resumeAgent/domain/factGuard.js";

const resume = {
  skills: { technical: ["Java"] },
  experience: [{ bullets: ["Improved API latency by 20%."] }],
};
const target = {
  requiredSkills: [{ name: "Kubernetes" }],
  preferredSkills: [],
};

test("fact guard blocks unverified skills and metrics", () => {
  const facts = buildVerifiedFacts(resume, []);
  const result = validateProposedChange({
    beforeValue: "Built Java APIs.",
    afterValue: "Built Kubernetes APIs and reduced latency by 70%.",
    target,
    verifiedFacts: facts,
    claimedSkills: ["Kubernetes"],
  });
  assert.equal(result.safe, false);
  assert.ok(result.violations.some((item) => item.code === "UNVERIFIED_SKILL"));
  assert.ok(result.violations.some((item) => item.code === "UNVERIFIED_METRIC" && item.value === "70%"));
});

test("fact guard accepts explicitly user-attested evidence", () => {
  const facts = buildVerifiedFacts(resume, [{
    factType: "skill",
    factKey: "Kubernetes",
    status: "verified",
    valueJson: { skill: "Kubernetes" },
    evidenceJson: { usageDetails: "Deployed three services", metric: "40%" },
  }]);
  const result = validateProposedChange({
    beforeValue: "Deployed services.",
    afterValue: "Deployed services with Kubernetes, reducing manual deployment time by 40%.",
    target,
    verifiedFacts: facts,
    claimedSkills: ["Kubernetes"],
  });
  assert.equal(result.safe, true);
});

test("fact guard blocks changes to protected identity fields", () => {
  const facts = buildVerifiedFacts(resume, []);
  const result = validateProposedChange({
    beforeValue: { company: "Example Inc.", title: "Engineer", bullets: ["Built APIs"] },
    afterValue: { company: "Invented Corp", title: "Senior Engineer", bullets: ["Built APIs"] },
    target: { requiredSkills: [], preferredSkills: [] },
    verifiedFacts: facts,
  });
  assert.equal(result.safe, false);
  assert.equal(result.violations.filter((item) => item.code === "PROTECTED_FACT_CHANGED").length, 2);
});
