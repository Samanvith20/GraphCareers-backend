import { generateObject, generateText } from "ai";
import { z } from "zod";
import { createOpenAI } from "@ai-sdk/openai";
import { createOpenRouter } from "@openrouter/ai-sdk-provider";
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
    afterValue: z.union([z.string(), z.array(z.string())]),
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

function createProvider(config) {
  if (config.provider === "openai") {
    return createOpenAI({ apiKey: config.apiKey, baseURL: config.baseURL });
  }
  return createOpenRouter({ apiKey: config.apiKey, baseURL: config.baseURL });
}

export function modelProviderErrorDetails(error, config) {
  const statusCode = Number(error?.statusCode);
  const providerCode = error?.data?.error?.code || error?.data?.code || error?.cause?.code || null;
  return {
    error: error?.message || "Unknown model provider error",
    errorName: error?.name || "Error",
    provider: config.provider,
    model: config.model,
    statusCode: Number.isFinite(statusCode) ? statusCode : null,
    providerCode,
    retryable: typeof error?.isRetryable === "boolean" ? error.isRetryable : null,
  };
}

export function isRetryableModelError(error) {
  if (error?.name === "AbortError") return true;
  if (typeof error?.isRetryable === "boolean") return error.isRetryable;
  const statusCode = Number(error?.statusCode);
  if (Number.isFinite(statusCode)) return statusCode === 408 || statusCode === 429 || statusCode >= 500;
  return true;
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
    this.modelFactory = modelFactory || createProvider(this.config);
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
      logger.warn("Resume target model extraction failed; deterministic result retained", {
        requestId,
        ...modelProviderErrorDetails(error, this.config),
      });
      return deterministic;
    }
  }

  async proposeChanges({ resume, target, score, instruction }, requestId) {
    if (!this.isConfigured()) return { summary: "No model provider configured", proposals: [] };
    try {
      const result = await withTimeout((abortSignal) => generateObject({
        model: this.modelFactory(this.config.model),
        schema: proposalSchema,
        abortSignal,
        temperature: 0.1,
        prompt: `You are a controlled resume editor. Propose concise changes that improve relevance without adding facts. Never add a skill, employer, project, responsibility, certification, degree, title, date, or number unless already supported by the same source field in the resume. Never combine numbers, outcomes, or responsibilities from different bullets. A target requirement is not evidence that the candidate has that skill. Return JSON Pointer paths that exist in the resume. Prefer rewriting and reordering over adding. For every proposal, claimedSkills must list only technical skills and technologies mentioned in the proposed value, including skills already present; do not list business outcomes or generic nouns. The rationale must explain what changed, why it helps the target, and which exact existing resume evidence supports it.\n\nUser instruction: ${instruction || "Optimize this resume for the target"}\n\nCurrent score:\n${JSON.stringify(score)}\n\nTarget:\n${JSON.stringify(target)}\n\nResume:\n${JSON.stringify(resume)}`,
      }), this.timeoutMs);
      logger.info("Resume agent proposals generated", { requestId, proposalCount: result.object.proposals.length, model: this.config.model, provider: this.config.provider });
      return result.object;
    } catch (error) {
      logger.error("Resume agent proposal provider call failed", {
        requestId,
        ...modelProviderErrorDetails(error, this.config),
      });
      throw error;
    }
  }

  async answer({ message, context }, requestId) {
    if (!this.isConfigured()) {
      return "I can explain the deterministic analysis, but conversational generation is unavailable until a resume-agent model provider is configured.";
    }
    try {
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
    } catch (error) {
      logger.error("Resume agent chat provider call failed", {
        requestId,
        ...modelProviderErrorDetails(error, this.config),
      });
      throw error;
    }
  }
}

export const resumeAgentModelGateway = new ResumeAgentModelGateway();
