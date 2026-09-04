import test from "node:test";
import assert from "node:assert/strict";
import {
  careerTargetSchema,
  missingSkillConfirmationSchema,
  platformRolesParamsSchema,
  platformRolesQuerySchema,
} from "../../src/modules/resumeAgent/resumeAgent.schemas.js";

test("career target requires a stored job id or complete inline job", () => {
  assert.equal(careerTargetSchema.safeParse({ companyName: "Example" }).success, false);
  assert.equal(careerTargetSchema.safeParse({ jobSourceId: "greenhouse-123" }).success, true);
  assert.equal(careerTargetSchema.safeParse({ jobTitle: "Engineer", jobDescription: "A".repeat(60) }).success, true);
});

test("professional skill confirmation requires usage evidence", () => {
  assert.equal(missingSkillConfirmationSchema.safeParse({ skill: "Kubernetes", confirmation: "used_professionally" }).success, false);
  assert.equal(missingSkillConfirmationSchema.safeParse({
    skill: "Kubernetes",
    confirmation: "used_professionally",
    usageDetails: "Deployed three services using deployments and services.",
  }).success, false);
  assert.equal(missingSkillConfirmationSchema.safeParse({
    skill: "Kubernetes",
    confirmation: "used_professionally",
    organizationOrProject: "Example Corp",
    usageDetails: "Deployed three services using deployments and services.",
  }).success, true);
});

test("platform role options normalize the platform and bound the result limit", () => {
  assert.deepEqual(platformRolesParamsSchema.parse({ platform: " Naukri " }), { platform: "naukri" });
  assert.deepEqual(platformRolesQuerySchema.parse({}), { search: "", limit: 100 });
  assert.equal(platformRolesQuerySchema.safeParse({ limit: 201 }).success, false);
});
