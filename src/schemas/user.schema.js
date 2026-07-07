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
  email: z.string().nullable(),
  phone: z.string().nullable(),
  location: z.string().nullable(),
  linkedin: z.string().nullable(),
  github: z.string().nullable(),

  bio: z.string().nullable(),

  skills: z.object({
    "Frontend": z.array(z.string()).optional(),
    "Backend": z.array(z.string()).optional(),
    "Database": z.array(z.string()).optional(),
    "DevOps & Cloud": z.array(z.string()).optional(),
    "AI & Data Science": z.array(z.string()).optional(),
    "Other Tools": z.array(z.string()).optional(),
  }),

  experience: z.array(
    z.object({
      company: z.string().nullable(),
      role: z.string().nullable(),
      startDate: z.string().nullable(),
      endDate: z.string().nullable(),
      experienceMonths: z.number(),
      description: z.array(z.string()),
    })
  ),

  projects: z.array(
    z.object({
      name: z.string().nullable(),
      techStack: z.array(z.string()),
      description: z.array(z.string()),
    })
  ),

  education: z.array(
    z.object({
      degree: z.string().nullable(),
      field: z.string().nullable(),
      institution: z.string().nullable(),
      startDate: z.string().nullable(),
      endDate: z.string().nullable(),
      gpa: z.string().nullable(),
      location: z.string().nullable(),
    })
  ),

  certifications: z.array(z.string()),
});