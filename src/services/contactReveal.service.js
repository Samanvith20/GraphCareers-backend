import { db } from "../db/index.js";
import { companyContacts, userContactCreditAccounts, userContactReveals } from "../db/schema.js";
import { eq, and, sql } from "drizzle-orm";
import { AppError } from "../lib/AppError.js";
import logger from "../logger/logger.js";
import { ProspeoProvider } from "../lib/prospeoProvider.js";

export class ContactRevealService {
  static maskEmail(email) {
    if (!email) return null;
    const [local, domain] = email.split("@");
    if (!domain) return email;
    const maskedLocal = local.charAt(0) + "*".repeat(Math.max(1, local.length - 1));
    return `${maskedLocal}@${domain}`;
  }

  static async getUserCredits(userId) {
    let account = await db.select().from(userContactCreditAccounts).where(eq(userContactCreditAccounts.userId, userId));
    
    if (account.length === 0) {
      try {
        account = await db.insert(userContactCreditAccounts).values({
          userId: userId,
          freeCreditsGranted: 5,
          creditsUsed: 0
        }).returning();
      } catch (err) {
        account = await db.select().from(userContactCreditAccounts).where(eq(userContactCreditAccounts.userId, userId));
      }
    }
    
    const acc = account[0];
    return Math.max(0, acc.freeCreditsGranted - acc.creditsUsed);
  }

  static async hasRevealed(userId, contactId) {
    const reveals = await db.select().from(userContactReveals)
      .where(and(
        eq(userContactReveals.userId, userId),
        eq(userContactReveals.contactId, contactId)
      ));
    return reveals.length > 0;
  }

  static async revealContact(userId, payload) {
    const { providerPersonId, companyDomain, fullName, title, linkedinUrl } = payload;

    // 1. Check if contact already exists in DB
    let contacts = await db.select().from(companyContacts).where(
      and(
        eq(companyContacts.provider, "prospeo"),
        eq(companyContacts.providerPersonId, providerPersonId)
      )
    );
    
    let contactId = null;
    let contact = null;

    if (contacts.length > 0) {
      contact = contacts[0];
      contactId = contact.id;

      if (!contact.email || contact.emailStatus !== "VERIFIED") {
        throw new AppError("Contact does not have a verified email", 400);
      }
    }

    // 2. Pre-flight check: Did user already reveal this?
    if (contactId && await this.hasRevealed(userId, contactId)) {
      const remaining = await this.getUserCredits(userId);
      return {
        success: true,
        data: {
          contact: {
            id: contact.id,
            fullName: contact.fullName,
            title: contact.title,
            linkedinUrl: contact.linkedinUrl,
            email: contact.email,
            isRevealed: true
          },
          creditCharged: false,
          credits: { remaining }
        }
      };
    }

    // 3. Initialize credit account
    await this.getUserCredits(userId);

    // 4. Atomic transaction
    try {
      const result = await db.transaction(async (tx) => {
        // Atomic test-and-set
        const updatedAccounts = await tx.update(userContactCreditAccounts)
          .set({ creditsUsed: sql`${userContactCreditAccounts.creditsUsed} + 1`, updatedAt: new Date() })
          .where(
            and(
              eq(userContactCreditAccounts.userId, userId),
              sql`${userContactCreditAccounts.creditsUsed} < ${userContactCreditAccounts.freeCreditsGranted}`
            )
          )
          .returning();

        if (updatedAccounts.length === 0) {
          const error = new Error("INSUFFICIENT_CONTACT_CREDITS");
          error.code = "INSUFFICIENT_CONTACT_CREDITS";
          throw error;
        }

        // If not in DB, fetch full email via Prospeo Enrich
        if (!contact) {
          logger.info(`Enriching candidate ${providerPersonId} via Prospeo before reveal`);
          const enrichedData = await ProspeoProvider.enrichPerson(providerPersonId);

          if (!enrichedData || enrichedData.emailStatus !== "VERIFIED" || !enrichedData.email) {
            throw new Error("PROVIDER_FAILED");
          }

          // Insert into DB
          const [upserted] = await tx.insert(companyContacts).values({
            companyName: companyDomain,
            provider: "prospeo",
            providerPersonId: providerPersonId,
            fullName: fullName || enrichedData.fullName || "Unknown",
            title: title || enrichedData.title,
            linkedinUrl: linkedinUrl || enrichedData.linkedinUrl,
            email: enrichedData.email.toLowerCase().trim(),
            emailStatus: enrichedData.emailStatus
          }).returning();

          contact = upserted;
          contactId = contact.id;
        }

        // Insert reveal record 
        await tx.insert(userContactReveals).values({
          userId,
          contactId,
          creditCharged: true
        });

        const acc = updatedAccounts[0];
        return Math.max(0, acc.freeCreditsGranted - acc.creditsUsed);
      });

      return {
        success: true,
        data: {
          contact: {
            id: contact.id,
            fullName: contact.fullName,
            title: contact.title,
            linkedinUrl: contact.linkedinUrl,
            email: contact.email,
            isRevealed: true
          },
          creditCharged: true,
          credits: { remaining: result }
        }
      };

    } catch (error) {
      if (error.code === "INSUFFICIENT_CONTACT_CREDITS" || (error.message && error.message.includes("INSUFFICIENT_CONTACT_CREDITS"))) {
        return {
          success: false,
          error: {
            code: "INSUFFICIENT_CONTACT_CREDITS",
            message: "You do not have enough contact reveal credits."
          },
          credits: { remaining: 0 }
        };
      }
      
      if (error.message === "PROVIDER_FAILED") {
        throw new AppError("Failed to fetch verified email from provider", 400);
      }
      
      if (error.code === '23505') { 
        const remaining = await this.getUserCredits(userId);
        return {
          success: true,
          data: {
            contact: {
              id: contact.id,
              fullName: contact.fullName,
              title: contact.title,
              linkedinUrl: contact.linkedinUrl,
              email: contact.email,
              isRevealed: true
            },
            creditCharged: false,
            credits: { remaining }
          }
        };
      }
      
      throw error;
    }
  }
}
