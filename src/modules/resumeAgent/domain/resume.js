import { normalizeTerm, uniqueTerms } from "./text.js";

function asArray(value) {
  if (Array.isArray(value)) return value;
  if (value === null || value === undefined || value === "") return [];
  return [value];
}

function firstPresent(...values) {
  return values.find((value) => typeof value === "string" && value.trim())?.trim() || null;
}

function contactFromText(sourceText) {
  const text = String(sourceText || "");
  const email = text.match(/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/i)?.[0] || null;
  const linkedin = text.match(/(?:https?:\/\/)?(?:www\.)?linkedin\.com\/[^\s|,;]+/i)?.[0] || null;
  const github = text.match(/(?:https?:\/\/)?(?:www\.)?github\.com\/[^\s|,;]+/i)?.[0] || null;
  const phoneCandidates = text.match(/(?:\+\d{1,3}[\s.-]?)?(?:\(?\d{2,5}\)?[\s.-]?)?(?:\d[\s.-]?){7,12}\d/g) || [];
  const phone = phoneCandidates.find((candidate) => {
    const digits = candidate.replace(/\D/g, "");
    return digits.length >= 10 && digits.length <= 15 && !/^\d{4}[\s.-]\d{1,2}[\s.-]\d{4}$/.test(candidate.trim());
  })?.trim() || null;
  return { email, phone, linkedin, github };
}

export function hydrateResumeContact(resume, { sourceText = "", fallbackContact = {} } = {}) {
  const hydrated = structuredClone(resume || {});
  const current = hydrated.contact && typeof hydrated.contact === "object" ? hydrated.contact : {};
  const detected = contactFromText(sourceText);
  hydrated.contact = {
    ...current,
    name: firstPresent(current.name, hydrated.name, fallbackContact.name),
    email: firstPresent(current.email, hydrated.email, fallbackContact.email, detected.email),
    phone: firstPresent(current.phone, hydrated.phone, fallbackContact.phone, detected.phone),
    location: firstPresent(current.location, hydrated.location, fallbackContact.location),
    linkedin: firstPresent(current.linkedin, current.linkedinUrl, hydrated.linkedin, hydrated.linkedinUrl, fallbackContact.linkedin, fallbackContact.linkedinUrl, detected.linkedin),
    github: firstPresent(current.github, current.githubUrl, hydrated.github, hydrated.githubUrl, fallbackContact.github, fallbackContact.githubUrl, detected.github),
    portfolio: firstPresent(current.portfolio, hydrated.portfolio, fallbackContact.portfolio),
  };
  return hydrated;
}

export function parseResumeSnapshot(value) {
  if (typeof value === "string") return hydrateResumeContact(JSON.parse(value));
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError("Resume snapshot must be a JSON object");
  }
  return hydrateResumeContact(value);
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
