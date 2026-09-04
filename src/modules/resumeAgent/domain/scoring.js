import { estimateExperienceYears, flattenResumeSkills, getExperienceBullets, resumeEvidenceText } from "./resume.js";
import { includesTerm, normalizeTerm, tokenOverlap } from "./text.js";

const ACTION_VERBS = /\b(achieved|automated|built|created|cut|delivered|designed|developed|drove|implemented|improved|increased|launched|led|managed|optimized|owned|reduced|scaled|streamlined)\b/i;
const METRIC_PATTERN = /(?:\b\d+(?:\.\d+)?\s?(?:%|x|k|m|b|ms|seconds?|minutes?|hours?|days?|users?|customers?|services?|projects?)\b|[$₹€£]\s?\d+)/i;

function clamp(value) {
  return Math.max(0, Math.min(100, Math.round(value)));
}

function hasContact(resume) {
  const contact = resume?.contact || {};
  return Boolean(contact.email || contact.phone || resume?.email || resume?.phone);
}

function hasNonEmptySection(value) {
  if (Array.isArray(value)) return value.length > 0;
  if (typeof value === "string") return value.trim().length > 0;
  if (value && typeof value === "object") return Object.values(value).some(hasNonEmptySection);
  return false;
}

export function scoreAtsCompatibility(resume) {
  const checks = [
    { id: "contact", label: "Contact information", weight: 20, passed: hasContact(resume) },
    { id: "summary", label: "Professional summary", weight: 10, passed: String(resume?.summary || "").trim().length >= 40 },
    { id: "experience", label: "Experience section", weight: 25, passed: hasNonEmptySection(resume?.experience) },
    { id: "skills", label: "Skills section", weight: 15, passed: flattenResumeSkills(resume).length > 0 },
    { id: "education", label: "Education section", weight: 10, passed: hasNonEmptySection(resume?.education) },
    { id: "standardStructure", label: "Standard structured sections", weight: 10, passed: !resume?.columns && !resume?.textBoxes },
    { id: "selectableText", label: "Machine-readable content", weight: 10, passed: resumeEvidenceText(resume).length >= 150 },
  ];
  const score = checks.reduce((sum, check) => sum + (check.passed ? check.weight : 0), 0);
  return { score: clamp(score), checks };
}

function matchesSkill(resumeText, resumeSkills, skillName) {
  const normalized = normalizeTerm(skillName);
  return resumeSkills.some((skill) => normalizeTerm(skill) === normalized) || includesTerm(resumeText, skillName);
}

export function scoreTargetMatch(resume, target) {
  const resumeText = resumeEvidenceText(resume);
  const resumeSkills = flattenResumeSkills(resume);
  const required = target?.requiredSkills || [];
  const preferred = target?.preferredSkills || [];
  const matchedRequired = required.filter((skill) => matchesSkill(resumeText, resumeSkills, skill.name));
  const matchedPreferred = preferred.filter((skill) => matchesSkill(resumeText, resumeSkills, skill.name));

  const requiredCoverage = required.length ? (matchedRequired.length / required.length) * 100 : 100;
  const preferredCoverage = preferred.length ? (matchedPreferred.length / preferred.length) * 100 : 100;

  const bullets = getExperienceBullets(resume);
  const responsibilities = target?.responsibilities || [];
  const responsibilityCoverage = responsibilities.length
    ? responsibilities.reduce((sum, responsibility) => {
        const best = bullets.reduce((max, bullet) => Math.max(max, tokenOverlap(responsibility, bullet)), 0);
        return sum + Math.min(1, best * 2.5);
      }, 0) / responsibilities.length * 100
    : 100;

  const years = estimateExperienceYears(resume);
  const minExperience = Number(target?.constraints?.minExperience);
  const experienceCoverage = Number.isFinite(minExperience) && minExperience > 0
    ? Math.min(100, (years / minExperience) * 100)
    : 100;

  const titleCoverage = target?.keywords?.[0]
    ? Math.min(100, tokenOverlap(target.keywords[0], resumeText) * 250)
    : 100;

  const score = clamp(
    (requiredCoverage * 0.40) +
    (preferredCoverage * 0.10) +
    (responsibilityCoverage * 0.25) +
    (experienceCoverage * 0.15) +
    (titleCoverage * 0.10)
  );

  return {
    score,
    breakdown: {
      requiredSkills: clamp(requiredCoverage),
      preferredSkills: clamp(preferredCoverage),
      responsibilities: clamp(responsibilityCoverage),
      experience: clamp(experienceCoverage),
      titleAndDomain: clamp(titleCoverage),
    },
    matchedSkills: [...matchedRequired, ...matchedPreferred].map((skill) => skill.name),
    missingRequiredSkills: required.filter((skill) => !matchedRequired.includes(skill)).map((skill) => skill.name),
    missingPreferredSkills: preferred.filter((skill) => !matchedPreferred.includes(skill)).map((skill) => skill.name),
  };
}

export function scoreResumeQuality(resume) {
  const bullets = getExperienceBullets(resume);
  const metricBullets = bullets.filter((bullet) => METRIC_PATTERN.test(bullet));
  const actionBullets = bullets.filter((bullet) => ACTION_VERBS.test(bullet));
  const usefulLength = bullets.filter((bullet) => bullet.length >= 45 && bullet.length <= 240);
  const summary = String(resume?.summary || "").trim();

  const evidence = bullets.length ? (metricBullets.length / bullets.length) * 100 : 0;
  const specificity = bullets.length ? (actionBullets.length / bullets.length) * 100 : 0;
  const clarity = bullets.length ? (usefulLength.length / bullets.length) * 100 : 0;
  const relevance = summary.length >= 40 && summary.length <= 500 ? 100 : summary.length > 0 ? 50 : 0;
  const score = clamp((evidence * 0.35) + (specificity * 0.25) + (clarity * 0.20) + (relevance * 0.20));
  return {
    score,
    breakdown: {
      evidenceAndImpact: clamp(evidence),
      specificity: clamp(specificity),
      clarity: clamp(clarity),
      relevanceAndConciseness: clamp(relevance),
    },
  };
}

export function scoreResumeForTarget(resume, target, targetType) {
  const atsCompatibility = scoreAtsCompatibility(resume);
  const targetMatch = scoreTargetMatch(resume, target);
  const resumeQuality = scoreResumeQuality(resume);
  const weights = targetType === "platform_market"
    ? { target: 0.45, ats: 0.30, quality: 0.25 }
    : { target: 0.50, ats: 0.25, quality: 0.25 };
  const overall = clamp(
    (targetMatch.score * weights.target) +
    (atsCompatibility.score * weights.ats) +
    (resumeQuality.score * weights.quality)
  );
  return { overall, atsCompatibility, targetMatch, resumeQuality, weights };
}
