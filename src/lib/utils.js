import neo4j from "neo4j-driver";

export const normalizeSkills = (skills, max=100) => {
   if (!skills) return [];
   
   let flatSkills = [];
   if (Array.isArray(skills)) {
     flatSkills = skills;
   } else if (typeof skills === "object") {
     flatSkills = Object.values(skills).flat();
   }

  return Array.from(
    new Set(
      flatSkills
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

export const SKILL_ALIASES = {
   react: ["react", "reactjs", "react.js"],
  node: ["node", "nodejs", "node.js"],
  dotnet: ["dotnet", ".net", "asp.net"],
  javascript: ["javascript", "js"],
  typescript: ["typescript", "ts"],
  nextjs: ["nextjs", "next.js"],
  express: ["express", "expressjs", "express.js"],
};