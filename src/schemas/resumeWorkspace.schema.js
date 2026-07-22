import { z } from "zod";

export const versionIdParamSchema = z.object({
  versionId: z.string().uuid({ message: "Invalid version ID format" }),
});

export const compareQuerySchema = z.object({
  versionA: z.string().uuid({ message: "Invalid versionA ID format" }),
  versionB: z.string().uuid({ message: "Invalid versionB ID format" }),
});

export const eventsQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(20),
  offset: z.coerce.number().int().min(0).default(0),
});
