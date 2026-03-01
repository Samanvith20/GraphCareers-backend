import { z } from "zod";

export const updateProfileSchema = z.object({
  name: z.string().min(2).max(100).optional(),
  location: z.string().min(2).max(100).optional(),
  bio: z.string().max(2000).optional(),
    experience: z.coerce.number().int().min(0).max(100).optional(),
  skills: z.array(z.string().min(1).max(50)).optional(),
  role: z.string().min(0).max(100).optional(),
});

export const ResumeSchema = z.object({
  name: z.string().nullable(),
  skills: z.array(z.string()),
  location: z.string().nullable(),
  experience: z.number(), // months
  bio: z.string().nullable(),
});