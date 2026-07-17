import { z } from "zod";

export const discoverContactSchema = z.object({
  jobId: z.string().optional().or(z.literal("")),
  jobTitle: z.string().min(1, "Job title is required"),
  companyName: z.string().min(1, "Company name is required"),
  companyDomain: z.string().optional().or(z.literal("")),
});

export const revealContactSchema = z.object({
  providerPersonId: z.string().min(1, "Provider person ID is required"),
  companyDomain: z.string().min(3, "Company domain is required"),
  fullName: z.string().optional(),
  title: z.string().optional(),
  linkedinUrl: z.string().optional()
});
