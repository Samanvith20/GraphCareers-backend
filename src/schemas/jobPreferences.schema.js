import { z } from "zod";

const choices = z.array(z.string().trim().min(1).max(120)).max(10)
  .transform(values => [...new Set(values.map(value => value.toLowerCase()))]);

// null = unanswered; [] = explicitly any. Omitted fields are preserved on PATCH.
export const jobPreferencesSchema = z.object({
  desiredRoles: choices.nullable().optional(),
  locations: choices.nullable().optional(),
  workModes: z.array(z.enum(["remote", "hybrid", "onsite"])).max(3).nullable().optional(),
  employmentTypes: z.array(z.enum(["full-time", "part-time", "contract", "internship"])).max(4).nullable().optional(),
}).strict().refine(value => Object.keys(value).length > 0, "Provide at least one preference");

export const emptyJobPreferences = {
  desiredRoles: null, locations: null, workModes: null, employmentTypes: null,
};

export function getFeedContext(user, preferences = {}) {
  const hasSkills = Array.isArray(user.skills) && user.skills.some(skill => typeof skill === "string" && skill.trim());
  const hasRole = Boolean(preferences.desiredRoles?.length);
  const experienceKnown = typeof user.experience === "number" && Number.isFinite(user.experience) && user.experience >= 0;
  return {
    mode: hasSkills ? "profile" : hasRole ? "role" : "explore",
    title: hasSkills ? "Suggested from your profile" : hasRole ? "Jobs for your selected roles" : "Explore recent jobs",
    description: hasSkills
      ? "Based on skill overlap and available experience. Skill coverage is not an overall suitability score."
      : "Recent listings, filtered only by details you provide. These are not personalized skill matches.",
    hasSkills: Boolean(hasSkills),
    experienceKnown,
    unanswered: Object.keys(emptyJobPreferences).filter(key => preferences[key] == null),
    warnings: [
      ...(!experienceKnown ? ["Your experience is unknown; check each job's requirements."] : []),
      ...(preferences.locations == null ? ["Location preference not provided; jobs may be anywhere."] : []),
      ...(preferences.desiredRoles == null ? ["Target role not selected; role suitability has not been confirmed."] : []),
    ],
  };
}
