import { ReferralsService } from "../services/referrals.service.js";
import { AppError } from "../lib/AppError.js";
import { z } from "zod";

const requestReferralsSchema = z.object({
  companyName: z.string().min(1, "Company name is required"),
  companyDomain: z.string().optional().or(z.literal("")),
  jobTitleContext: z.string().optional(),
  locationContext: z.string().optional()
});

export class ReferralsController {
  static async requestReferrals(req, res, next) {
    try {
      const parsed = requestReferralsSchema.parse(req.body);
      const userId = req.userId;

      const result = await ReferralsService.requestReferrals({
        userId,
        ...parsed
      });

      return res.status(200).json(result);
    } catch (error) {
      if (error.name === "ZodError") {
        return next(new AppError(error.issues[0].message, 400));
      }
      next(error);
    }
  }

  static async getDashboard(req, res, next) {
    try {
      const userId = req.userId;
      const dashboard = await ReferralsService.getUserDashboard(userId);

      return res.status(200).json({
        success: true,
        data: dashboard
      });
    } catch (error) {
      next(error);
    }
  }
}
