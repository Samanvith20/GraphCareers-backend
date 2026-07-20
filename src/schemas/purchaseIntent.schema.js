import { z } from "zod";

export const purchaseIntentSchema = z.object({
  featureType: z.string().min(1).max(255),
  packName: z.string().min(1).max(255),
  price: z.string().min(1).max(255),
  intent: z.enum(["yes", "maybe", "no"]),
  reason: z.string().max(1000).optional().nullable(),
});
