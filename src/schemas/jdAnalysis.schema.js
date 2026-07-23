import { z } from "zod";

export const jdOptimizationSchema = z.object({
  platform: z.string().optional().default("general"),
  jobTitle: z.string().min(1, "Job title is required"),
  companyName: z.string().min(1, "Company name is required"),
  jobDescription: z.string().min(10, "Job description is too short"),
});
