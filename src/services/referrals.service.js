import { db } from "../db/index.js";
import { companyReferralCandidates, userReferralRequests, companyContacts, userContactReveals } from "../db/schema.js";
import { eq, and, desc } from "drizzle-orm";
import logger from "../logger/logger.js";
import { ProspeoProvider } from "../lib/prospeoProvider.js";
import { rankCandidates } from "./contactDiscovery.service.js";
import { AppError } from "../lib/AppError.js";

export class ReferralsService {
  /**
   * Discovers and caches top referrals for a company, and links them to the user's dashboard.
   * If the cache already exists, it instantly returns them.
   */
  static async requestReferrals({ userId, companyName, companyDomain, jobTitleContext, locationContext }) {
    if (!companyName) {
      throw new AppError("Company name is required", 400);
    }

    try {
      // 1. Check if we already have this company cached in the global pool
      const existingCandidates = await db.select()
        .from(companyReferralCandidates)
        .where(eq(companyReferralCandidates.companyName, companyName))
        .orderBy(desc(companyReferralCandidates.score))
        .limit(10);

      let status = "completed";
      
      // 2. If we don't have them cached, fetch from Prospeo
      if (existingCandidates.length === 0) {
        logger.info(`Referral Cache Miss for ${companyName}. Calling Prospeo.`);
        let searchData;
        try {
          searchData = await ProspeoProvider.searchPeople({ 
            companyName, 
            companyDomain, 
            location: locationContext 
          });
        } catch (err) {
          if (err.statusCode === 400 || err.status === 400 || (err.message && err.message.includes("400"))) {
            logger.warn(`Prospeo rejected company ${companyName} (400 Bad Request)`);
            status = "failed_error";
          } else {
            throw err;
          }
        }

        if (status !== "failed_error" && searchData && searchData.candidates) {
          const eligible = searchData.candidates.filter(c => c.emailStatus === "VERIFIED");

          if (eligible.length === 0) {
            status = "failed_no_contacts";
          } else {
            // Rank them
            const ranked = rankCandidates(eligible, jobTitleContext || "", companyDomain || "");
            ranked.sort((a, b) => b.totalScore - a.totalScore);
            const topCandidates = ranked.slice(0, 10);

            // Save to DB cache
            if (topCandidates.length > 0) {
              const insertPayload = topCandidates.map(info => ({
                companyName: companyName,
                provider: info.candidate.provider,
                providerPersonId: info.candidate.providerPersonId,
                fullName: info.candidate.fullName,
                title: info.candidate.currentJobTitle,
                linkedinUrl: info.candidate.linkedinUrl,
                location: locationContext || null,
                department: info.candidate.departments?.join(", ") || null,
                score: info.totalScore
              }));

              await db.insert(companyReferralCandidates)
                .values(insertPayload)
                .onConflictDoNothing({
                  target: [companyReferralCandidates.companyName, companyReferralCandidates.provider, companyReferralCandidates.providerPersonId]
                });
            } else {
              status = "failed_no_contacts";
            }
          }
        } else if (!searchData) {
          status = "failed_no_contacts";
        }
      }

      // 3. Link this request to the user's personal dashboard
      await db.insert(userReferralRequests)
        .values({
          userId,
          companyName,
          jobTitleContext,
          locationContext,
          status
        })
        .onConflictDoUpdate({
          target: [userReferralRequests.userId, userReferralRequests.companyName],
          set: { status, updatedAt: new Date() }
        });

      return { success: true, status, companyName };
    } catch (error) {
      logger.error("Error in requestReferrals:", error);
      throw error;
    }
  }

  /**
   * Fetches the user's dedicated Referrals Dashboard data.
   * Returns all requested companies, and attaches the cached top candidates if completed.
   */
  static async getUserDashboard(userId) {
    // Fetch all user requests
    const requests = await db.select()
      .from(userReferralRequests)
      .where(eq(userReferralRequests.userId, userId))
      .orderBy(desc(userReferralRequests.updatedAt));

    // Fetch globally all revealed contacts for this user
    const userReveals = await db.select({
      providerPersonId: companyContacts.providerPersonId,
      email: companyContacts.email
    })
    .from(userContactReveals)
    .innerJoin(companyContacts, eq(userContactReveals.contactId, companyContacts.id))
    .where(eq(userContactReveals.userId, userId));
    
    // Create a map for O(1) lookup
    const revealedMap = new Map();
    for (const r of userReveals) {
      revealedMap.set(r.providerPersonId, r.email);
    }

    const dashboard = [];

    for (const req of requests) {
      const item = {
        requestId: req.id,
        companyName: req.companyName,
        jobTitleContext: req.jobTitleContext,
        locationContext: req.locationContext,
        status: req.status,
        requestedAt: req.createdAt,
        contacts: []
      };

      if (req.status === "completed") {
        const candidates = await db.select()
          .from(companyReferralCandidates)
          .where(eq(companyReferralCandidates.companyName, req.companyName))
          .orderBy(desc(companyReferralCandidates.score))
          .limit(10);
        
        item.contacts = candidates.map(c => {
          const revealedEmail = revealedMap.get(c.providerPersonId);
          return {
            id: c.id,
            providerPersonId: c.providerPersonId,
            fullName: c.fullName,
            title: c.title,
            linkedinUrl: c.linkedinUrl,
            score: c.score,
            isRevealed: !!revealedEmail,
            email: revealedEmail || null
          };
        });
      }

      dashboard.push(item);
    }

    return dashboard;
  }
}
