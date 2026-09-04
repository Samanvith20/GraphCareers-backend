import { z } from "zod";

const httpUrl = z.string().url().max(3000);
const optionalUrl = z.union([httpUrl, z.literal("")]).optional().transform((value) => value || undefined);
const uuidParams = z.object({ id: z.string().uuid() });

export const targetIdParamsSchema = uuidParams;
export const runIdParamsSchema = uuidParams;
export const proposalIdParamsSchema = uuidParams;

export const platformRolesParamsSchema = z.object({
  platform: z.string().trim().min(2).max(100).transform((value) => value.toLowerCase()),
});

export const platformRolesQuerySchema = z.object({
  search: z.string().trim().max(100).default(""),
  limit: z.coerce.number().int().min(1).max(200).default(100),
});

export const platformTargetSchema = z.object({
  platform: z.string().trim().min(2).max(100).transform((value) => value.toLowerCase()),
  role: z.string().trim().min(2).max(200),
  location: z.string().trim().max(200).optional(),
  minExperience: z.coerce.number().min(0).max(60).optional(),
  maxExperience: z.coerce.number().min(0).max(60).optional(),
  sampleSize: z.coerce.number().int().min(10).max(200).default(100),
});

export const careerTargetSchema = z.object({
  jobSourceId: z.string().trim().min(1).max(255).optional(),
  jobTitle: z.string().trim().min(2).max(300).optional(),
  companyName: z.string().trim().min(1).max(300).optional(),
  jobDescription: z.string().trim().min(50).max(100_000).optional(),
  platform: z.string().trim().max(100).optional(),
  atsVendor: z.string().trim().max(100).optional(),
  jobUrl: optionalUrl,
  applicationUrl: optionalUrl,
  screeningQuestions: z.array(z.object({
    question: z.string().trim().min(1).max(1000),
    required: z.boolean().default(false),
    disqualifier: z.boolean().default(false),
  })).max(100).optional(),
}).superRefine((value, ctx) => {
  if (!value.jobSourceId && !(value.jobTitle && value.jobDescription)) {
    ctx.addIssue({ code: "custom", message: "Provide jobSourceId or both jobTitle and jobDescription" });
  }
});

export const manualTargetSchema = z.object({
  jobTitle: z.string().trim().min(2).max(300),
  companyName: z.string().trim().max(300).optional(),
  jobDescription: z.string().trim().min(50).max(100_000),
  jobUrl: optionalUrl,
  applicationUrl: optionalUrl,
  platform: z.string().trim().max(100).optional(),
  atsVendor: z.string().trim().max(100).optional(),
});

export const createRunSchema = z.object({
  targetId: z.string().uuid(),
  baseVersionId: z.string().uuid().optional(),
  mode: z.enum(["analyze", "optimize"]).default("optimize"),
  idempotencyKey: z.string().trim().min(8).max(128),
});

export const chatSchema = z.object({
  message: z.string().trim().min(1).max(4000),
  clientMessageId: z.string().trim().min(8).max(128).optional(),
});

export const missingSkillConfirmationSchema = z.object({
  skill: z.string().trim().min(1).max(120),
  confirmation: z.enum([
    "used_professionally",
    "used_in_project",
    "completed_course",
    "basic_knowledge",
    "not_used",
  ]),
  context: z.string().trim().max(2000).optional(),
  organizationOrProject: z.string().trim().max(300).optional(),
  usageDetails: z.string().trim().max(3000).optional(),
  metric: z.string().trim().max(300).optional(),
  applyTo: z.enum(["skills", "experience", "project", "learning"]).optional(),
}).superRefine((value, ctx) => {
  if (["used_professionally", "used_in_project"].includes(value.confirmation) && !value.usageDetails) {
    ctx.addIssue({ code: "custom", path: ["usageDetails"], message: "Usage details are required for experience or project claims" });
  }
  if (["used_professionally", "used_in_project"].includes(value.confirmation) && !value.organizationOrProject) {
    ctx.addIssue({ code: "custom", path: ["organizationOrProject"], message: "The matching employer or project is required for experience or project claims" });
  }
});

export const proposalDecisionSchema = z.object({
  decision: z.enum(["approve", "reject"]),
});

export const listMessagesQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(50),
  before: z.string().datetime().optional(),
});

export function parseRequest(schema, value) {
  const result = schema.safeParse(value);
  if (result.success) return result.data;
  const error = new Error(result.error.issues[0]?.message || "Invalid request");
  error.name = "RequestValidationError";
  error.issues = result.error.issues;
  throw error;
}
