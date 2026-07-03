import {
  fetchUserProfile,
  fetchMatchedJobs,
  fetchCareerProgression,
} from "../../services/chat.services.js";
import logger from "../../logger/logger.js";

export const toolDefinitions = [
  {
    type: "function",
    function: {
      name: "getUserData",
      description:
        "Get the user's full profile — skills, resume, experience, career stage. ALWAYS call this first for any career question.",
      parameters: {
        type: "object",
        properties: {},
        additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: "getUserMatchedJobs",
      description:
        "Get jobs matched to the user profile. Use ONLY when user asks about jobs, recommendations, or gap analysis.",
      parameters: {
        type: "object",
        properties: {
          limit: {
            type: "number",
            description: "Max jobs to return, default 5",
          },
        },
        additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: "getCareerProgression",
      description:
        "Get career progression insights — skill gaps, path to next role. Use ONLY when user asks about learning, growth, or career path.",
      parameters: {
        type: "object",
        properties: {},
        additionalProperties: false,
      },
    },
  },
];

export async function executeTool(name, args, userId) {
  logger.debug("[tool] executing", { tool: name, userId });
  try {
    switch (name) {
      case "getUserData":
        return await fetchUserProfile({ userId });
      case "getUserMatchedJobs":
        return await fetchMatchedJobs({ userId, limit: args?.limit ?? 5 });
      case "getCareerProgression":
        return await fetchCareerProgression({ userId });
      default:
        return { error: `Unknown tool: ${name}` };
    }
  } catch (err) {
    logger.error("[tool] execution failed", {
      tool:    name,
      userId,
      message: err.message,
    });
    return { error: `${name} failed: ${err.message}` };
  }
}
