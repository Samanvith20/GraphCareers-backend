import neo4j from "neo4j-driver";

export const normalizeSkills = (skills,max=100) =>{
   if (!Array.isArray(skills)) return [];

  return Array.from(
    new Set(
      skills
        .map((s) => String(s).toLowerCase().trim())
        .filter(Boolean)
    )
  ).slice(0, max);
}
  


export function normalizeSkill(skill) {
  if (!skill || typeof skill !== "string") return null;
  return skill.toLowerCase().trim();
}

export function toNumber(value) {
  if (neo4j.isInt(value)) return value.toNumber();
  return value;
}

export const getTargetLevels = (experienceMonths) => {
  const years = experienceMonths / 12;

  if (years < 1) return { current: ["entry"], next: ["junior", "mid"] };
  if (years < 2) return { current: ["entry", "junior"], next: ["mid"] };
  if (years < 4) return { current: ["junior", "mid"], next: ["senior"] };
  if (years < 7) return { current: ["mid", "senior"], next: ["senior", "lead"] };
  return { current: ["senior", "lead"], next: ["lead", "staff", "principal"] };
};