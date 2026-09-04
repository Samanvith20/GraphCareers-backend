import { flattenResumeSkills, resumeEvidenceText } from "./resume.js";
import { includesTerm, normalizeTerm } from "./text.js";

function extractNumbers(value) {
  return new Set(
    (String(value || "").match(/\d[\d,]*(?:\.\d+)?%?/g) || [])
      .map((number) => number.replaceAll(",", "")),
  );
}

export function buildVerifiedFacts(resume, assertions = [], sourceEvidenceText = null) {
  const resumeText = resumeEvidenceText(resume);
  const trustedSourceText = String(sourceEvidenceText || "").trim() || resumeText;
  const skills = new Set(flattenResumeSkills(resume).map(normalizeTerm));
  const assertionEvidenceParts = [];
  for (const assertion of assertions) {
    if (assertion.status && assertion.status !== "verified") continue;
    if (assertion.factType === "skill") skills.add(normalizeTerm(assertion.factKey));
    assertionEvidenceParts.push(JSON.stringify(assertion.valueJson || {}), JSON.stringify(assertion.evidenceJson || {}));
  }
  return {
    skills,
    evidenceText: [trustedSourceText, ...assertionEvidenceParts].join(" "),
    sourceEvidenceText: trustedSourceText,
    assertionEvidenceText: assertionEvidenceParts.join(" "),
  };
}

export function validateProposedChange({ beforeValue, afterValue, target, verifiedFacts, claimedSkills = [] }) {
  const violations = [];
  const beforeNumbers = extractNumbers(beforeValue);
  const sourceNumbers = extractNumbers(verifiedFacts.sourceEvidenceText);
  const assertionNumbers = extractNumbers(verifiedFacts.assertionEvidenceText);
  for (const number of extractNumbers(afterValue)) {
    const supportedOriginalClaim = beforeNumbers.has(number) && sourceNumbers.has(number);
    if (!supportedOriginalClaim && !assertionNumbers.has(number)) {
      violations.push({ code: "UNVERIFIED_METRIC", value: number });
    }
  }

  const targetSkills = [
    ...(target?.requiredSkills || []),
    ...(target?.preferredSkills || []),
  ];
  const afterText = JSON.stringify(afterValue);
  const beforeText = JSON.stringify(beforeValue);
  for (const skill of targetSkills) {
    const normalized = normalizeTerm(skill.name);
    const newlyAdded = includesTerm(afterText, normalized) && !includesTerm(beforeText, normalized);
    if (newlyAdded && !verifiedFacts.skills.has(normalized)) {
      violations.push({ code: "UNVERIFIED_SKILL", value: skill.name });
    }
  }
  for (const skill of claimedSkills) {
    if (!verifiedFacts.skills.has(normalizeTerm(skill))) {
      violations.push({ code: "UNVERIFIED_SKILL", value: skill });
    }
  }

  const protectedFields = ["company", "employer", "organization", "name", "title", "degree", "institution", "startDate", "endDate", "date"];
  if (beforeValue && afterValue && typeof beforeValue === "object" && typeof afterValue === "object" && !Array.isArray(afterValue)) {
    for (const field of protectedFields) {
      if (!Object.hasOwn(afterValue, field)) continue;
      const before = beforeValue[field];
      const after = afterValue[field];
      if (JSON.stringify(before) !== JSON.stringify(after) && !includesTerm(verifiedFacts.evidenceText, String(after))) {
        violations.push({ code: "PROTECTED_FACT_CHANGED", value: field });
      }
    }
  }

  const uniqueViolations = violations.filter((violation, index, all) => (
    all.findIndex((candidate) => candidate.code === violation.code && candidate.value === violation.value) === index
  ));
  return { safe: uniqueViolations.length === 0, violations: uniqueViolations };
}
