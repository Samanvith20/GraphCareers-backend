import { createHash } from "node:crypto";
import { normalizeTerm, stableStringify, tokenOverlap, uniqueTerms } from "./text.js";

const COMMON_SKILLS = [
  "Java", "JavaScript", "TypeScript", "Python", "C#", "C++", "Go", "Rust", "PHP", "Ruby", "Kotlin", "Swift",
  "React", "Next.js", "Angular", "Vue.js", "Node.js", "Express", "NestJS", "Spring Boot", ".NET", "Django", "Flask", "FastAPI",
  "HTML", "CSS", "Tailwind CSS", "REST", "GraphQL", "Microservices", "System Design", "Data Structures", "Algorithms",
  "PostgreSQL", "MySQL", "MongoDB", "Redis", "Elasticsearch", "DynamoDB", "SQL", "NoSQL",
  "AWS", "Azure", "Google Cloud", "Docker", "Kubernetes", "Terraform", "Jenkins", "GitHub Actions", "CI/CD", "Linux", "Git",
  "Kafka", "RabbitMQ", "Spark", "Hadoop", "Airflow", "dbt", "Snowflake", "Databricks",
  "Machine Learning", "Deep Learning", "NLP", "LLM", "Generative AI", "TensorFlow", "PyTorch", "scikit-learn", "Pandas", "NumPy",
  "Power BI", "Tableau", "Excel", "Figma", "Product Management", "Agile", "Scrum", "Jira", "Salesforce", "SAP",
];

const SKILL_LOOKUP = new Map(COMMON_SKILLS.map((skill) => [normalizeTerm(skill), skill]));

function extractKnownSkills(text) {
  const normalizedText = ` ${normalizeTerm(text)} `;
  const matches = [];
  for (const [normalized, display] of SKILL_LOOKUP.entries()) {
    if (normalizedText.includes(` ${normalized} `)) matches.push(display);
  }
  return matches;
}

function extractResponsibilities(description) {
  return String(description || "")
    .split(/\r?\n/)
    .map((line) => line.replace(/^\s*[-*•\d.)]+\s*/, "").trim())
    .filter((line) => line.length >= 25 && line.length <= 280)
    .filter((line) => /^(build|create|design|develop|deliver|drive|implement|lead|manage|own|maintain|collaborate|analyze|support|work|architect|improve|optimize|define)/i.test(line))
    .slice(0, 12);
}

function normalizeRequirements(requirements = {}) {
  const normalizeSkillList = (values, importance) => uniqueTerms(values || []).map((name) => ({ name, importance }));
  return {
    requiredSkills: normalizeSkillList(requirements.requiredSkills, "required"),
    preferredSkills: normalizeSkillList(requirements.preferredSkills, "preferred"),
    responsibilities: uniqueTerms(requirements.responsibilities || []).slice(0, 20),
    keywords: uniqueTerms(requirements.keywords || []).slice(0, 40),
    constraints: requirements.constraints || {},
    market: requirements.market || null,
    analysisConfidence: requirements.analysisConfidence || "medium",
  };
}

export function buildExactTarget({ type, jobTitle, companyName, jobDescription, platform, atsVendor, metadata = {} }) {
  const explicitRequired = [
    ...(metadata.requiredSkills || []),
    ...(metadata.skillsTechnical || []),
    ...(metadata.skillsTools || []),
  ];
  const discovered = extractKnownSkills(jobDescription);
  const requiredSkills = uniqueTerms([...explicitRequired, ...discovered]);
  const preferredSkills = uniqueTerms(metadata.preferredSkills || []).filter(
    (skill) => !requiredSkills.some((required) => normalizeTerm(required) === normalizeTerm(skill)),
  );

  return normalizeRequirements({
    requiredSkills,
    preferredSkills,
    responsibilities: metadata.responsibilities?.length ? metadata.responsibilities : extractResponsibilities(jobDescription),
    keywords: uniqueTerms([jobTitle, ...requiredSkills, ...(metadata.keywords || [])]),
    constraints: {
      minExperience: metadata.minExperience ?? metadata.minExp ?? null,
      maxExperience: metadata.maxExperience ?? metadata.maxExp ?? null,
      location: metadata.location || null,
      workMode: metadata.workMode || null,
      education: metadata.education || null,
      workAuthorization: metadata.workAuthorization || null,
      screeningQuestions: metadata.screeningQuestions || [],
    },
    analysisConfidence: explicitRequired.length > 0 ? "high" : discovered.length > 0 ? "medium" : "low",
    source: { type, platform, companyName, atsVendor },
  });
}

function recencyWeight(postedAt, now) {
  const timestamp = postedAt ? new Date(postedAt).getTime() : NaN;
  if (!Number.isFinite(timestamp)) return 0.65;
  const ageDays = Math.max(0, (now.getTime() - timestamp) / 86_400_000);
  return Math.max(0.35, 1 - (ageDays / 180));
}

export function buildPlatformTarget({ platform, role, jobs, now = new Date() }) {
  const demand = new Map();
  let minExperienceTotal = 0;
  let minExperienceCount = 0;

  for (const job of jobs) {
    const roleWeight = 0.75 + tokenOverlap(role, `${job.title || ""} ${job.roleTitle || ""}`);
    const weight = roleWeight * recencyWeight(job.postedAt, now);
    const skills = uniqueTerms([
      ...(job.skillsTechnical || []),
      ...(job.skillsTools || []),
      ...extractKnownSkills(job.description || ""),
    ]);
    for (const skill of skills) {
      const key = normalizeTerm(skill);
      const current = demand.get(key) || { name: skill, weighted: 0, jobs: 0 };
      current.weighted += weight;
      current.jobs += 1;
      demand.set(key, current);
    }
    if (Number.isFinite(Number(job.minExp))) {
      minExperienceTotal += Number(job.minExp);
      minExperienceCount += 1;
    }
  }

  const ranked = [...demand.values()]
    .map((entry) => ({
      name: entry.name,
      demandPercent: jobs.length ? Math.round((entry.jobs / jobs.length) * 100) : 0,
      weight: Math.round(entry.weighted * 100) / 100,
    }))
    .sort((left, right) => right.weight - left.weight || right.demandPercent - left.demandPercent);

  const requiredSkills = ranked.filter((skill) => skill.demandPercent >= 30).slice(0, 12);
  const preferredSkills = ranked.filter((skill) => skill.demandPercent < 30).slice(0, 15);

  return normalizeRequirements({
    requiredSkills: requiredSkills.map((skill) => skill.name),
    preferredSkills: preferredSkills.map((skill) => skill.name),
    responsibilities: [],
    keywords: uniqueTerms([role, ...ranked.slice(0, 25).map((skill) => skill.name)]),
    constraints: {
      minExperience: minExperienceCount ? Math.round((minExperienceTotal / minExperienceCount) * 10) / 10 : null,
    },
    market: {
      platform,
      role,
      sampleSize: jobs.length,
      rankedSkills: ranked.slice(0, 30),
    },
    analysisConfidence: jobs.length >= 50 ? "high" : jobs.length >= 15 ? "medium" : "low",
  });
}

export function targetFingerprint(value) {
  return createHash("sha256").update(stableStringify(value)).digest("hex");
}

