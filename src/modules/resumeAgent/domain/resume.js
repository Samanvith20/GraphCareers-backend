import { normalizeTerm, uniqueTerms } from "./text.js";

function asArray(value) {
  if (Array.isArray(value)) return value;
  if (value === null || value === undefined || value === "") return [];
  return [value];
}

export function parseResumeSnapshot(value) {
  if (typeof value === "string") return JSON.parse(value);
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError("Resume snapshot must be a JSON object");
  }
  return structuredClone(value);
}

export function flattenResumeSkills(resume) {
  const skills = [];
  if (Array.isArray(resume?.skills)) {
    skills.push(...resume.skills);
  } else if (resume?.skills && typeof resume.skills === "object") {
    for (const value of Object.values(resume.skills)) skills.push(...asArray(value));
  }

  for (const project of asArray(resume?.projects)) {
    skills.push(...asArray(project?.technologies));
    skills.push(...asArray(project?.skills));
  }

  return uniqueTerms(skills.map((skill) => typeof skill === "string" ? skill : skill?.name));
}

export function resumeEvidenceText(resume) {
  return JSON.stringify(resume || {})
    .replace(/[{}\[\]",:]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function getExperienceBullets(resume) {
  const bullets = [];
  for (const experience of asArray(resume?.experience)) {
    bullets.push(...asArray(experience?.bullets));
    if (experience?.description) bullets.push(experience.description);
  }
  for (const project of asArray(resume?.projects)) {
    bullets.push(...asArray(project?.bullets));
    if (project?.description) bullets.push(project.description);
  }
  return bullets.filter((value) => typeof value === "string" && value.trim());
}

export function estimateExperienceYears(resume) {
  const explicitMonths = asArray(resume?.experience).reduce(
    (sum, entry) => sum + (Number(entry?.experienceMonths) || 0),
    0,
  );
  if (explicitMonths > 0) return Math.round((explicitMonths / 12) * 10) / 10;

  const ranges = [];
  for (const entry of asArray(resume?.experience)) {
    const start = Date.parse(entry?.startDate || entry?.start || "");
    const endValue = entry?.endDate || entry?.end;
    const end = !endValue || /present|current/i.test(String(endValue)) ? Date.now() : Date.parse(endValue);
    if (Number.isFinite(start) && Number.isFinite(end) && end >= start) ranges.push([start, end]);
  }
  const months = ranges.reduce((sum, [start, end]) => sum + ((end - start) / 2_629_800_000), 0);
  return Math.round((months / 12) * 10) / 10;
}

export function findSkillCategory(resume, skill) {
  if (!resume?.skills || Array.isArray(resume.skills) || typeof resume.skills !== "object") return null;
  const normalized = normalizeTerm(skill);
  for (const [category, values] of Object.entries(resume.skills)) {
    if (asArray(values).some((value) => normalizeTerm(value) === normalized)) return category;
  }
  return null;
}

export function defaultSkillPath(resume) {
  if (Array.isArray(resume?.skills)) return "/skills";
  const categories = Object.keys(resume?.skills || {});
  const preferred = categories.find((category) => /technical|technolog|tool|core/i.test(category));
  return `/skills/${escapeJsonPointer(preferred || categories[0] || "technical")}`;
}

export function escapeJsonPointer(value) {
  return String(value).replace(/~/g, "~0").replace(/\//g, "~1");
}

