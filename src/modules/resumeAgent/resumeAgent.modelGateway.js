import { generateObject, generateText } from "ai";
import { z } from "zod";
import { createOpenAI } from "@ai-sdk/openai";
import logger from "../../logger/logger.js";
import { normalizeTerm, uniqueTerms } from "./domain/text.js";

const extractedTargetSchema = z.object({
  requiredSkills: z.array(z.string()).max(40),
  preferredSkills: z.array(z.string()).max(40),
  responsibilities: z.array(z.string()).max(20),
  keywords: z.array(z.string()).max(50),
  constraints: z.object({
    minExperience: z.number().nullable(),
    maxExperience: z.number().nullable(),
    location: z.string().nullable(),
    workMode: z.string().nullable(),
    education: z.string().nullable(),
    workAuthorization: z.string().nullable(),
  }),
});

const proposalSchema = z.object({
  summary: z.string().max(1000),
  proposals: z.array(z.object({
    proposalType: z.enum(["rewrite_summary", "rewrite_bullet", "reorder_skills"]),
    targetPath: z.string().startsWith("/"),
    afterValue: z.unknown(),
    rationale: z.string().min(1).max(1000),
    claimedSkills: z.array(z.string()).max(20),
  })).max(20),
});

function providerConfig() {
  const provider = String(process.env.RESUME_AGENT_PROVIDER || "openrouter").toLowerCase();
  if (provider === "openai") {
    return {
      provider,
      apiKey: process.env.OPENAI_API_KEY,
      baseURL: process.env.RESUME_AGENT_BASE_URL || undefined,
      model: process.env.RESUME_AGENT_MODEL || "gpt-4.1-mini",
    };
  }
  return {
    provider: "openrouter",
    apiKey: process.env.OPENROUTER_API_KEY,
    baseURL: process.env.RESUME_AGENT_BASE_URL || process.env.OPENAI_BASE_URL || "https://openrouter.ai/api/v1",
    model: process.env.RESUME_AGENT_MODEL || process.env.OPENROUTER_MODEL || "openai/gpt-4o-mini",
  };
}

async function withTimeout(operation, timeoutMs = 15_000) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await operation(controller.signal);
  } finally {
    clearTimeout(timeout);
  }
}

export class ResumeAgentModelGateway {
  constructor({ modelFactory, timeoutMs = Number(process.env.RESUME_AGENT_TIMEOUT_MS) || 15_000 } = {}) {
    this.config = providerConfig();
    this.modelFactory = modelFactory || createOpenAI({ apiKey: this.config.apiKey, baseURL: this.config.baseURL });
    this.timeoutMs = timeoutMs;
  }

  isConfigured() {
    return Boolean(this.config.apiKey);
  }

  async extractTarget({ jobTitle, companyName, jobDescription, deterministic }, requestId) {
    if (!this.isConfigured()) return deterministic;
    try {
      const result = await withTimeout((abortSignal) => generateObject({
        model: this.modelFactory(this.config.model),
        schema: extractedTargetSchema,
        abortSignal,
        temperature: 0,
        prompt: `Extract only explicit hiring requirements from this job description. Distinguish required from preferred. Do not infer technologies that are not written.\n\nTitle: ${jobTitle}\nCompany: ${companyName || "Unknown"}\n\n${jobDescription}`,
      }), this.timeoutMs);
      const requiredNames = uniqueTerms(result.object.requiredSkills);
      const requiredSet = new Set(requiredNames.map(normalizeTerm));
      const preferredNames = uniqueTerms(result.object.preferredSkills).filter((skill) => !requiredSet.has(normalizeTerm(skill)));
      return {
        ...deterministic,
        requiredSkills: requiredNames.map((name) => ({ name, importance: "required" })),
        preferredSkills: preferredNames.map((name) => ({ name, importance: "preferred" })),
        responsibilities: uniqueTerms(result.object.responsibilities),
        keywords: uniqueTerms(result.object.keywords),
        constraints: { ...deterministic.constraints, ...result.object.constraints },
        analysisConfidence: "high",
      };
    } catch (error) {
      logger.warn("Resume target model extraction failed; deterministic result retained", { requestId, error: error.message });
      return deterministic;
    }
  }

  async proposeChanges({ resume, target, score, instruction }, requestId) {
    if (!this.isConfigured()) return { summary: "No model provider configured", proposals: [] };
    const result = await withTimeout((abortSignal) => generateObject({
      model: this.modelFactory(this.config.model),
      schema: proposalSchema,
      abortSignal,
      temperature: 0.1,
      prompt: `You are a controlled resume editor. Propose concise changes that improve relevance without adding facts. Never add a skill, employer, project, responsibility, certification, degree, title, date, or number unless already supported by the resume. Return JSON Pointer paths that exist in the resume. Prefer rewriting and reordering over adding. For every proposal, claimedSkills must list every skill or technology mentioned in the proposed value, including skills already present.\n\nUser instruction: ${instruction || "Optimize this resume for the target"}\n\nCurrent score:\n${JSON.stringify(score)}\n\nTarget:\n${JSON.stringify(target)}\n\nResume:\n${JSON.stringify(resume)}`,
    }), this.timeoutMs);
    logger.info("Resume agent proposals generated", { requestId, proposalCount: result.object.proposals.length, model: this.config.model, provider: this.config.provider });
    return result.object;
  }

  async answer({ message, context }, requestId) {
    if (!this.isConfigured()) {
      return "I can explain the deterministic analysis, but conversational generation is unavailable until a resume-agent model provider is configured.";
    }
    const result = await withTimeout((abortSignal) => generateText({
      model: this.modelFactory(this.config.model),
      abortSignal,
      temperature: 0.2,
      maxTokens: 700,
      system: "You are GraphCareers Resume Agent. Use only the supplied user-owned context. Explain scores and gaps honestly. Never claim that a third-party ATS gave an official score. Do not say a missing skill was added unless the context shows it is verified and applied.",
      prompt: `${message}\n\nContext:\n${JSON.stringify(context)}`,
    }), this.timeoutMs);
    logger.info("Resume agent chat response generated", { requestId, model: this.config.model, provider: this.config.provider });
    return result.text.trim();
  }
}

export const resumeAgentModelGateway = new ResumeAgentModelGateway();
