// app/api/user-jobs/schema.ts
import { z } from "zod";

export const userJobUpsertSchema = z.object({
  jobUrl: z.string().url(),
  jobTitle: z.string().min(1).optional(),
  company: z.string().min(1).optional(),
  source: z.string().min(1), // linkedin, naukri, etc

  status: z.enum([
    "new",
    "viewed",
    "saved",
    "applied",
    "interviewing",
    "offer",
    "rejected",
    "ignored",
  ]),

  notes: z.string().optional(),
});
