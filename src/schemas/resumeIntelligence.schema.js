import { z } from "zod";

export const SUPPORTED_PLATFORMS = ["naukri", "instahyre", "foundit", "internshala"];

/**
 * Validates the :platform URL parameter.
 * Rejects unknown platforms with a descriptive message.
 */
export const platformParamSchema = z.object({
  platform: z.enum(SUPPORTED_PLATFORMS, {
    errorMap: () => ({
      message: `Platform must be one of: ${SUPPORTED_PLATFORMS.join(", ")}`,
    }),
  }),
});
