import { db } from "../db/index.js";
import { companyContacts } from "../db/schema.js";
import { eq, and } from "drizzle-orm";
import logger from "../logger/logger.js";
import { ProspeoProvider } from "../lib/prospeoProvider.js";
import { AppError } from "../lib/AppError.js";

// === Constants for Ranking ===
const COMPANY_SIZE_BUCKETS = {
  SMALL: "SMALL",   // 1-20
  MEDIUM: "MEDIUM", // 21-200
  LARGE: "LARGE",   // 201+
  UNKNOWN: "UNKNOWN"
};

const JOB_FAMILIES = {
  ENGINEERING: "ENGINEERING",
  DATA: "DATA",
  PRODUCT: "PRODUCT",
  DESIGN: "DESIGN",
  SALES: "SALES",
  MARKETING: "MARKETING",
  HR: "HR",
  OTHER: "OTHER"
};

const BASE_SCORES = {
  "founder": 90,
  "co-founder": 90,
  "co founder": 90,
  "cto": 95,
  "chief technology officer": 95,
  "vp engineering": 95,
  "head of engineering": 95,
  "director of engineering": 90,
  "engineering manager": 95,
  "technical recruiter": 92,
  "talent acquisition": 92,
  "recruiter": 88,
  "chief people officer": 90,
  "head of people": 90,
  "hr director": 85,
  "lead": 82, // generic lead
  "senior": 65,
  "engineer": 55,
  "developer": 55
};

// === Helper Functions ===
function normalizeDomain(domain) {
  if (!domain) return null;
  try {
    let clean = domain.trim().toLowerCase();
    if (!clean.startsWith("http")) clean = "https://" + clean;
    const url = new URL(clean);
    let host = url.hostname;
    if (host.startsWith("www.")) host = host.substring(4);
    return host;
  } catch (e) {
    return domain.trim().toLowerCase().replace(/^www\./, "");
  }
}

function getCompanySizeBucket(count, rangeStr) {
  if (typeof count === 'number') {
    if (count <= 20) return COMPANY_SIZE_BUCKETS.SMALL;
    if (count <= 200) return COMPANY_SIZE_BUCKETS.MEDIUM;
    return COMPANY_SIZE_BUCKETS.LARGE;
  }
  if (rangeStr) {
    if (rangeStr.includes("1-10") || rangeStr.includes("11-50")) return COMPANY_SIZE_BUCKETS.SMALL;
    if (rangeStr.includes("51-200")) return COMPANY_SIZE_BUCKETS.MEDIUM;
    if (rangeStr.includes("201") || rangeStr.includes("500") || rangeStr.includes("1000")) return COMPANY_SIZE_BUCKETS.LARGE;
  }
  return COMPANY_SIZE_BUCKETS.UNKNOWN;
}

function getJobFamily(title) {
  if (!title) return JOB_FAMILIES.OTHER;
  const lower = title.toLowerCase();
  
  if (/(engineer|developer|frontend|backend|full stack|devops|react|node|sre)/.test(lower)) return JOB_FAMILIES.ENGINEERING;
  if (/(data|machine learning|ml|ai engineer|analytics)/.test(lower)) return JOB_FAMILIES.DATA;
  if (/(product manager|product owner)/.test(lower)) return JOB_FAMILIES.PRODUCT;
  if (/(design|ux|ui)/.test(lower)) return JOB_FAMILIES.DESIGN;
  if (/(sales|account executive|business development)/.test(lower)) return JOB_FAMILIES.SALES;
  if (/(marketing|growth)/.test(lower)) return JOB_FAMILIES.MARKETING;
  if (/(hr|human resources|recruiter|talent|people)/.test(lower)) return JOB_FAMILIES.HR;

  return JOB_FAMILIES.OTHER;
}

function getBaseInfluenceScore(candidateTitle) {
  if (!candidateTitle) return 20;
  const lower = candidateTitle.toLowerCase();
  
  let bestScore = 20;
  for (const [key, score] of Object.entries(BASE_SCORES)) {
    if (lower.includes(key) && score > bestScore) {
      bestScore = score;
    }
  }
  return bestScore;
}

function getSizeAdjustment(baseTitle, sizeBucket) {
  if (!baseTitle) return 0;
  const lower = baseTitle.toLowerCase();
  
  if (sizeBucket === COMPANY_SIZE_BUCKETS.SMALL) {
    if (lower.includes("founder")) return 20;
    if (lower.includes("cto")) return 15;
    if (lower.includes("people")) return 12;
    if (lower.includes("manager")) return 10;
    if (lower.includes("recruiter")) return 8;
    if (lower.includes("engineer")) return 5;
  }
  
  if (sizeBucket === COMPANY_SIZE_BUCKETS.MEDIUM) {
    if (lower.includes("manager") && lower.includes("engineer")) return 20;
    if (lower.includes("recruiter") || lower.includes("talent")) return 18;
    if (lower.includes("cto")) return 5;
    if (lower.includes("founder")) return -10;
  }
  
  if (sizeBucket === COMPANY_SIZE_BUCKETS.LARGE) {
    if (lower.includes("recruiter") || lower.includes("talent")) return 25;
    if (lower.includes("manager") && lower.includes("engineer")) return 22;
    if (lower.includes("director")) return 15;
    if (lower.includes("cto")) return -25;
    if (lower.includes("founder")) return -50;
  }
  return 0;
}

function getJobFamilyRelevance(jobFamily, candidateTitle) {
  if (!candidateTitle) return 0;
  const lower = candidateTitle.toLowerCase();
  let score = 0;
  
  const isEngineering = /(engineer|cto)/.test(lower);
  const isData = /(data|ai|ml)/.test(lower);
  const isProduct = /(product)/.test(lower);
  const isDesign = /(design|ux|ui)/.test(lower);
  const isRecruiter = /(recruiter|talent|hr|people)/.test(lower);
  const isSales = /(sales|business development|account)/.test(lower);
  const isMarketing = /(marketing)/.test(lower);
  const isFinance = /(finance)/.test(lower);
  
  if (jobFamily === JOB_FAMILIES.ENGINEERING) {
    if (isEngineering || isRecruiter) score += 20;
    if (isSales || isMarketing || isFinance) score -= 30;
  } else if (jobFamily === JOB_FAMILIES.DATA) {
    if (isData || isRecruiter) score += 20;
    if (isSales || isMarketing || isFinance) score -= 30;
  } else if (jobFamily === JOB_FAMILIES.PRODUCT) {
    if (isProduct || isRecruiter) score += 20;
  } else if (jobFamily === JOB_FAMILIES.DESIGN) {
    if (isDesign || isRecruiter) score += 20;
  }
  
  // Generic penalties
  if (lower.includes("chief marketing") || lower.includes("cmo") || isSales || isFinance) {
    score -= 40;
  }
  
  return score;
}

function getTitleRelevance(jobTitle, candidateTitle) {
  if (!jobTitle || !candidateTitle) return 0;
  const jWords = jobTitle.toLowerCase().replace(/[^a-z0-9 ]/g, "").split(" ").filter(w => w.length > 2);
  const cWords = candidateTitle.toLowerCase().replace(/[^a-z0-9 ]/g, "").split(" ").filter(w => w.length > 2);
  
  let overlap = 0;
  for (const w of jWords) {
    if (cWords.includes(w)) overlap += 5;
  }
  return Math.min(overlap, 20); // Cap at 20
}

function rankCandidates(candidates, jobTitle, companyDomain) {
  const jobFamily = getJobFamily(jobTitle);
  
  const ranked = candidates.map(c => {
    const sizeBucket = getCompanySizeBucket(c.companyEmployeeCount, c.companyEmployeeRange);
    const baseInfluence = getBaseInfluenceScore(c.currentJobTitle);
    const companySizeFit = getSizeAdjustment(c.currentJobTitle, sizeBucket);
    const jobFamilyRelevance = getJobFamilyRelevance(jobFamily, c.currentJobTitle);
    const titleRelevance = getTitleRelevance(jobTitle, c.currentJobTitle);
    
    let penalties = 0;
    let computedJobFamilyRelevance = jobFamilyRelevance;
    if (jobFamilyRelevance < 0) {
      penalties = jobFamilyRelevance;
      computedJobFamilyRelevance = 0;
    }
    
    const totalScore = baseInfluence + companySizeFit + computedJobFamilyRelevance + titleRelevance + penalties;
    
    return {
      candidate: c,
      totalScore,
      scoreBreakdown: {
        baseInfluence,
        companySizeFit,
        jobFamilyRelevance: computedJobFamilyRelevance,
        titleRelevance,
        penalties
      },
      reasons: [
        `${c.currentJobTitle} at a ${sizeBucket} size company.`,
        `Base Influence: ${baseInfluence}`,
        `Job Family (${jobFamily}) relevance: ${computedJobFamilyRelevance}`
      ]
    };
  });
  
  // Sort deterministically
  ranked.sort((a, b) => {
    if (b.totalScore !== a.totalScore) return b.totalScore - a.totalScore;
    if (b.scoreBreakdown.jobFamilyRelevance !== a.scoreBreakdown.jobFamilyRelevance) {
      return b.scoreBreakdown.jobFamilyRelevance - a.scoreBreakdown.jobFamilyRelevance;
    }
    if (b.scoreBreakdown.baseInfluence !== a.scoreBreakdown.baseInfluence) {
      return b.scoreBreakdown.baseInfluence - a.scoreBreakdown.baseInfluence;
    }
    if (b.scoreBreakdown.titleRelevance !== a.scoreBreakdown.titleRelevance) {
      return b.scoreBreakdown.titleRelevance - a.scoreBreakdown.titleRelevance;
    }
    const nameA = a.candidate.fullName || "";
    const nameB = b.candidate.fullName || "";
    return nameA.localeCompare(nameB);
  });
  
  return ranked;
}


export class ContactDiscoveryService {
  /**
   * Discovers the top N ranked contacts for a given domain and job title.
   * Does NOT call enrich endpoint. Does NOT persist to DB.
   */
  static async discoverTopContacts({ companyDomain, jobTitle, limit = 4 }) {
    try {
      const targetDomain = normalizeDomain(companyDomain);
      if (!targetDomain) {
        return { status: "INVALID_DOMAIN" };
      }

      // 2. Call Prospeo Provider
      logger.info(`Calling Prospeo search for domain ${targetDomain}`);
      const searchData = await ProspeoProvider.searchPeople(targetDomain);
      
      if (searchData.candidates.length === 0) {
        return { status: "NO_PEOPLE_FOUND" };
      }

      // 3. Validate and Filter
      const eligible = searchData.candidates.filter(c => {
        const cDom = normalizeDomain(c.companyDomain);
        if (cDom && cDom !== targetDomain) return false;
        
        return c.emailStatus === "VERIFIED";
      });

      if (eligible.length === 0) {
        return { status: "NO_ELIGIBLE_CONTACT" };
      }

      // 4. Sort and take top N
      const ranked = rankCandidates(eligible, jobTitle, targetDomain);
      ranked.sort((a, b) => b.totalScore - a.totalScore);
      const topCandidates = ranked.slice(0, limit);

      const formattedCandidates = topCandidates.map(info => ({
        providerPersonId: info.candidate.providerPersonId,
        fullName: info.candidate.fullName,
        title: info.candidate.currentJobTitle,
        linkedinUrl: info.candidate.linkedinUrl,
        companyDomain: targetDomain,
        emailMasked: info.candidate.maskedEmail,
        score: info.totalScore,
        reasons: info.reasons
      }));

      return {
        status: "FOUND",
        source: "prospeo_search",
        candidates: formattedCandidates
      };
    } catch (err) {
      logger.error("Error in discoverTopContacts", {
        error: err.message,
        companyDomain
      });
      throw err;
    }
  }
}
