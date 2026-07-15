import { discoverContactSchema, revealContactSchema } from "../schemas/contacts.schema.js";
import { ContactDiscoveryService } from "../services/contactDiscovery.service.js";
import { ContactRevealService } from "../services/contactReveal.service.js";
import { AppError } from "../lib/AppError.js";

export class ContactsController {
  static async discover(req, res, next) {
    try {
      const parsed = discoverContactSchema.parse(req.body);
      const userId = req.user.id;

      // Discover Top 4 Contacts
      const discoveryResult = await ContactDiscoveryService.discoverTopContacts({
        companyDomain: parsed.companyDomain,
        jobTitle: parsed.jobTitle,
        limit: 4
      });

      if (discoveryResult.status !== "FOUND") {
        return res.status(200).json({
          success: false,
          status: discoveryResult.status
        });
      }

      const remainingCredits = await ContactRevealService.getUserCredits(userId);

      return res.status(200).json({
        success: true,
        data: {
          candidates: discoveryResult.candidates.map(c => ({
            ...c,
            isRevealed: false
          })),
          credits: {
            remaining: remainingCredits
          }
        }
      });
    } catch (error) {
      if (error.name === "ZodError") {
        return next(new AppError(error.errors[0].message, 400));
      }
      next(error);
    }
  }

  static async reveal(req, res, next) {
    try {
      // Validate Input from Body (since they aren't in DB yet)
      const parsed = revealContactSchema.parse(req.body);
      const userId = req.user.id;

      // Call Atomic Reveal Service
      const result = await ContactRevealService.revealContact(userId, parsed);

      if (result.success === false) {
        return res.status(402).json(result);
      }

      return res.status(200).json(result);
    } catch (error) {
      if (error.name === "ZodError") {
        return next(new AppError(error.errors[0].message, 400));
      }
      next(error);
    }
  }
}
