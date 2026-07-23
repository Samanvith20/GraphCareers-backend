import { db } from "../db/index.js";
import { resumeWorkspaceIntelligence, resumeWorkspaces } from "../db/schema.js";
import { eq } from "drizzle-orm";
import logger from "../logger/logger.js";
import { scoreResume } from "../services/resumeScore.service.js";

export const CURRENT_INTELLIGENCE_VERSION = 1;

/**
 * Deterministically extracts knowledge from a resume version.
 * @param {string} workspaceId 
 * @param {object} structuredJson 
 */
export async function buildWorkspaceIntelligence(workspaceId, structuredJson) {
  try {
    const intelligence = extractIntelligence(structuredJson);
    const intelligenceStr = JSON.stringify(intelligence);

    // Upsert into resume_workspace_intelligence
    await db
      .insert(resumeWorkspaceIntelligence)
      .values({
        workspaceId,
        engineVersion: CURRENT_INTELLIGENCE_VERSION,
        intelligenceJson: intelligenceStr,
      })
      .onConflictDoUpdate({
        target: resumeWorkspaceIntelligence.workspaceId,
        set: {
          engineVersion: CURRENT_INTELLIGENCE_VERSION,
          intelligenceJson: intelligenceStr,
          updatedAt: new Date(),
        },
      });

    // Update workspace version
    await db
      .update(resumeWorkspaces)
      .set({ intelligenceVersion: CURRENT_INTELLIGENCE_VERSION })
      .where(eq(resumeWorkspaces.id, workspaceId));

    logger.info("Resume intelligence rebuilt successfully", { workspaceId, engineVersion: CURRENT_INTELLIGENCE_VERSION });

    return intelligence;
  } catch (err) {
    logger.error("Failed to build resume intelligence", { workspaceId, error: err.message });
    throw err;
  }
}

/**
 * Core deterministic extraction logic.
 */
function extractIntelligence(json) {
  // 1. Skills
  const verifiedSkills = [];
  const skillCategories = {};
  if (json.skills && typeof json.skills === "object") {
    for (const [category, skillsArr] of Object.entries(json.skills)) {
      if (Array.isArray(skillsArr)) {
        skillCategories[category] = skillsArr;
        verifiedSkills.push(...skillsArr);
      }
    }
  }

  // 2. Experience
  let totalMonths = 0;
  let expSummary = "";
  if (Array.isArray(json.experience)) {
    for (const exp of json.experience) {
      if (exp.experienceMonths) totalMonths += exp.experienceMonths;
      if (exp.description) expSummary += exp.description + " ";
    }
  }
  let level = "Entry-Level";
  if (totalMonths > 24) level = "Mid-Level";
  if (totalMonths > 84) level = "Senior-Level";

  // 3. Projects
  const projectTech = new Set();
  const evidenceMap = {};
  if (Array.isArray(json.projects)) {
    for (const proj of json.projects) {
      const techStr = (proj.technologies || []).join(", ");
      if (techStr) projectTech.add(techStr);
      if (proj.name && proj.description) {
        evidenceMap[proj.name] = proj.description;
      }
    }
  }

  // 4. Achievements (Regex matching numbers, %, $)
  const quantifiedMetrics = [];
  const metricRegex = /(\d+(?:\.\d+)?%|\$\d+(?:,\d+)*(?:\.\d+)?(?:k|M|B)?|\d+x)/gi;
  
  const scanForMetrics = (text) => {
    if (!text) return;
    const matches = text.match(metricRegex);
    if (matches) {
      quantifiedMetrics.push(text.trim());
    }
  };

  if (Array.isArray(json.experience)) {
    json.experience.forEach(exp => {
      if (Array.isArray(exp.bullets)) {
        exp.bullets.forEach(scanForMetrics);
      }
      scanForMetrics(exp.description);
    });
  }
  if (Array.isArray(json.projects)) {
    json.projects.forEach(proj => {
      if (Array.isArray(proj.bullets)) {
        proj.bullets.forEach(scanForMetrics);
      }
      scanForMetrics(proj.description);
    });
  }

  // 5. Baseline Score
  const scoreResult = scoreResume({
    resumeText: JSON.stringify(json),
    structuredJson: json,
    platform: "generic",
    trends: null,
    experienceMonths: totalMonths,
  });

  const missingSections = [];
  ["summary", "experience", "education", "skills"].forEach(sec => {
    if (!json[sec] || (Array.isArray(json[sec]) && json[sec].length === 0) || (typeof json[sec] === "object" && Object.keys(json[sec]).length === 0)) {
      missingSections.push(sec);
    }
  });

  const completenessScore = 100 - (missingSections.length * 15);

  const strengths = [];
  const weaknesses = [];
  if (quantifiedMetrics.length > 3) strengths.push("Strong use of quantified metrics");
  else weaknesses.push("Lacks quantified achievements");

  if (verifiedSkills.length > 10) strengths.push("Good skill density");
  if (missingSections.length > 0) weaknesses.push(`Missing key sections: ${missingSections.join(", ")}`);

  return {
    skills: {
      verified: [...new Set(verifiedSkills)],
      categories: skillCategories,
    },
    experience: {
      totalMonths,
      level,
      summary: expSummary.substring(0, 500).trim(), // truncate
    },
    projects: {
      technologies: [...projectTech],
      evidenceMap,
    },
    achievements: {
      quantifiedMetrics: [...new Set(quantifiedMetrics)],
    },
    baseline: {
      atsScore: scoreResult.total,
      keywordCoverage: { matched: [], missing: [] },
      completenessScore: Math.max(0, completenessScore),
      missingSections,
      strengths,
      weaknesses,
    }
  };
}
