import { generateObject } from "ai";
import { openrouter } from "../lib/openai.js";
import { z } from "zod";
import logger from "../logger/logger.js";
import { AppError } from "../lib/AppError.js";

const jdExtractionSchema = z.object({
  requiredSkills: z.array(z.string()),
  preferredSkills: z.array(z.string()),
  responsibilities: z.array(z.string()),
  technologies: z.array(z.string()),
  seniority: z.string(),
  domain: z.string(),
  keywords: z.array(z.string()),
  softSkills: z.array(z.string()),
});

/**
 * Parses raw Job Description text into structured JSON.
 */
export async function analyzeJobDescription(jobTitle, companyName, jobDescription) {
  logger.info("Extracting structured data from Job Description", { jobTitle, companyName });

  const prompt = `
You are an expert technical recruiter analyzing a job description.
Extract the core requirements for the following role:
Role: ${jobTitle}
Company: ${companyName}

Job Description:
${jobDescription}

Extract the required skills, preferred skills, core responsibilities, technologies mentioned, the implied seniority, domain/industry, crucial ATS keywords, and soft skills.
`;

  try {
    const result = await generateObject({
      model: openrouter(process.env.OPENROUTER_MODEL || "openai/gpt-4o-mini"),
      schema: jdExtractionSchema,
      prompt,
      temperature: 0.1,
    });
    return result.object;
  } catch (err) {
    logger.error("Failed to extract JD", { error: err.message });
    throw new AppError("Could not analyze Job Description.", 500);
  }
}

/**
 * Compares JD Extraction with Resume Intelligence to produce a Match Report.
 */
export function generateMatchReport(jdExtraction, intelligence) {
  const userSkills = new Set([
    ...(intelligence?.skills?.verified || []).map(s => s.toLowerCase()),
    // Also grab raw text skills if they exist
  ]);

  const jdAllSkills = [...jdExtraction.requiredSkills, ...jdExtraction.technologies].map(s => s.toLowerCase());
  
  const strongSkills = [];
  const missingSkills = [];

  for (const skill of jdAllSkills) {
    let matched = false;
    for (const uSkill of userSkills) {
      if (uSkill.includes(skill) || skill.includes(uSkill)) {
        matched = true;
        break;
      }
    }
    if (matched) {
      strongSkills.push(skill);
    } else {
      missingSkills.push(skill);
    }
  }

  // Very rudimentary scoring logic
  const totalSkills = jdAllSkills.length || 1;
  const skillsCoverage = Math.round((strongSkills.length / totalSkills) * 100);

  return {
    overallMatch: skillsCoverage > 100 ? 100 : skillsCoverage,
    skillsCoverage: skillsCoverage > 100 ? 100 : skillsCoverage,
    keywordCoverage: skillsCoverage, // simplified
    experienceCoverage: 80, // simplified baseline
    missingSkills: Array.from(new Set(missingSkills)).slice(0, 10),
    strongSkills: Array.from(new Set(strongSkills)).slice(0, 10),
  };
}
