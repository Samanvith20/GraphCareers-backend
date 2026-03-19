import { tool } from "@openai/agents";
import { z } from "zod";
import {
  fetchUserProfile,
  fetchMatchedJobs,
  fetchCareerProgression,
} from "../../services/ai.services.js";

export function createAgentTools(userId) {
  return [
    tool({
      name: "getUserData",
      description:
        "Get the user's full profile — skills, resume, experience, career stage. ALWAYS call this first for any career question.",
      parameters: z.object({}),
      execute: async () => {
        console.log("[tool] getUserData called for userId:", userId);
        const result = await fetchUserProfile({ userId });
       // console.log("[tool] getUserData result:", JSON.stringify(result).slice(0, 200));
        return JSON.stringify(result);
      },
    }),

    tool({
      name: "getUserMatchedJobs",
      description:
        "Get jobs matched to the user profile. Use for job recommendations, gap analysis, or market comparison.",
      parameters: z.object({
        limit: z.number().optional().default(10),
      }),
      execute: async ({ limit }) => {
        console.log("[tool] getUserMatchedJobs called, limit:", limit);
        const result = await fetchMatchedJobs({ userId, limit: limit ?? 10 });
       // console.log("[tool] getUserMatchedJobs result count:", result?.data?.length);
        return JSON.stringify(result);
      },
    }),

    tool({
      name: "getCareerProgression",
      description:
        "Get career progression insights — skill gaps, path to next role, milestones.",
      parameters: z.object({}),
      execute: async () => {
        console.log("[tool] getCareerProgression called for userId:", userId);
        const result = await fetchCareerProgression({ userId });
        return JSON.stringify(result);
      },
    }),
  ];
}