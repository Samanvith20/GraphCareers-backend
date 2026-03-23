import { and, desc, eq,gt, inArray, sql } from "drizzle-orm";
import { db } from "../db/index.js";
import { users, resumes, jobMatches, jobs, aiUsageLogs } from "../db/schema.js";
import { getCareerInsightsService } from "./careerProgression.service.js";
import { rewriteQuery } from "../lib/ai/rewriteQuery.js";
import { toolDefinitions, executeTool } from "../lib/ai/tools.js";
import { openai } from "../lib/openai.js";
import logger from "../logger/logger.js";
import { AppError } from "../lib/AppError.js";

import { getUserAccessFromUser, consumeUserCredits } from "./userAccess.service.js";

// ─── Credit cost per complexity ───────────────────────────────────────────────
//
//  basic  (1 credit) — greeting, simple career Q, no tools
//  tool   (2 credits) — 1–2 tool calls (profile lookup, job fetch)
//  deep   (3 credits) — 3+ tool calls or career progression analysis
//
const COMPLEXITY_COST = { basic: 1, tool: 2, deep: 3 };

// ─── Detect complexity from the user message BEFORE calling GPT ──────────────
// This lets us fail fast if credits < required cost.
function estimateComplexity(userMessage) {
  const msg = userMessage.toLowerCase();

  // Deep: career plan, roadmap, progression, full advice
  if (
    msg.includes("career") ||
    msg.includes("roadmap") ||
    msg.includes("progression") ||
    msg.includes("what should i") ||
    msg.includes("learning path") ||
    msg.includes("skill gap")
  ) return "deep";

  // Tool: profile questions, jobs, salary, companies
  if (
    msg.includes("job") ||
    msg.includes("skill") ||
    msg.includes("my profile") ||
    msg.includes("salary") ||
    msg.includes("company") ||
    msg.includes("match") ||
    msg.includes("resume")
  ) return "tool";

  // Basic: greetings, simple one-liners
  return "basic";
}

const SYSTEM_PROMPT = `You are a Chatbot, a senior career mentor AI on a job platform. You speak like a real mentor — warm, direct, and specific. Not a chatbot.

═══════════════════════════════════════
IDENTITY & SCOPE
═══════════════════════════════════════
- You ONLY help with career-related topics:
  job searching, skill gaps, learning paths, resume advice,
  interview prep, salary negotiation, career switching.
- For ANY other topic (general knowledge, math, coding help,
  personal questions unrelated to career, news, entertainment):
  → Say: "I'm focused on your career growth — I can't help with that,
    but ask me anything about your job search or skills!"
- Never reveal you are built on GPT or any AI model.

═══════════════════════════════════════
TOOL USAGE RULES
═══════════════════════════════════════
- Greetings (hi, hello, good morning) → respond warmly, NO tools
- "What is my name / my skills / my profile" → getUserData only
- Learning path, skill gaps, what to learn → getUserData + getCareerProgression
- Job search, job market, get a job → getUserData + getUserMatchedJobs
- Comprehensive career advice → all 3 tools
- NEVER call tools for out-of-scope questions

═══════════════════════════════════════
TONE & STYLE — MENTOR, NOT CHATBOT
═══════════════════════════════════════
- Write like a mentor who has read the user's full file
- Be specific — use their actual skills, role, experience
- Be honest — if gaps exist, name them clearly
- Be encouraging but realistic
- Use "you" and "your" — make it personal
- NO generic advice that could apply to anyone
- NO filler phrases like "Great question!" or "Certainly!"
- Start answers directly — no preambles

═══════════════════════════════════════
FORMAT RULES
═══════════════════════════════════════
- Use markdown: ## headings, **bold**, bullet points
- Keep answers focused — don't pad with unnecessary sections
- For career questions: situation → insight → action
- For roadmaps: structured timeline with specific weekly goals
- Max 3-4 sections per answer unless user asks for detail

═══════════════════════════════════════
EXAMPLE MENTOR RESPONSES
═══════════════════════════════════════
User: "what should I learn next?"
BAD: "Based on industry trends, you should consider learning SQL..."
GOOD: "You've got a strong fullstack base — React, Node, Docker.
The gap showing up most in your matched jobs is SQL.
Here's why that matters for you specifically: [specific reason]"

User: "what's the capital of France?"
RESPONSE: "I'm focused on your career growth — I can't help with that,
but ask me anything about your job search or upskilling!"`;

export async function* chatService(messages, userId) {

  // ── 1. Fetch user + plan in one shot ──────────────────────────────────────
  const user = await db.query.users.findFirst({
    where: eq(users.id, userId),
    columns: { id: true, credits: true, tier: true, planExpiresAt: true },
  });
  if (!user) throw new AppError("User not found", 404);

  const access = getUserAccessFromUser(user);

  // ── 2. Upfront credit check — fail BEFORE any GPT call ────────────────────
  const userMessage  = messages[messages.length - 1]?.content || "";
  const complexity   = estimateComplexity(userMessage);
  const estimatedCost = COMPLEXITY_COST[complexity];

  if (access.credits < estimatedCost) {
    const isPro = access.plan === "pro";
 
    const message = isPro
      ? `You've used all 100 Pro credits this month — you have ${access.credits} left. Your credits reset at the start of your next billing cycle.`
      : `This response costs ${estimatedCost} credit${estimatedCost > 1 ? "s" : ""} and you have ${access.credits} free credit${access.credits === 1 ? "" : "s"} remaining. Upgrade to Pro for 100 credits/month.`;
 
    throw new AppError(message, 402);
  }

  // ── 3. Rewrite query (lightweight, no model call) ─────────────────────────
  const rewrittenQuery = await rewriteQuery(userMessage);

  const history = messages.slice(0, -1).map((m) => ({
    role:    m.role,
    content: typeof m.content === "string" ? m.content : String(m.content),
  }));

  const agentMessages = [
    { role: "system", content: SYSTEM_PROMPT },
    ...history,
    { role: "user", content: rewrittenQuery },
  ];

  logger.info("[agent] turns:", agentMessages.length, "| complexity:", complexity, "| query:", rewrittenQuery);

  let totalInputTokens  = 0;
  let totalOutputTokens = 0;
  let actualComplexity  = complexity; // may upgrade if more tools run than expected
  const MAX_TURNS = 6;

  // ── 4. Agentic loop ────────────────────────────────────────────────────────
  for (let turn = 0; turn < MAX_TURNS; turn++) {

    // Non-streaming call to detect tool calls
    const response = await openai.chat.completions.create({
      model:        "gpt-4o",
      messages:     agentMessages,
      tools:        toolDefinitions,
      tool_choice:  "auto",
      stream:       false,
      // Keep context tight — reduces latency significantly
      max_tokens:   1200,
    });

    if (response.usage) {
      totalInputTokens  += response.usage.prompt_tokens    ?? 0;
      totalOutputTokens += response.usage.completion_tokens ?? 0;
    }

    const assistantMsg = response.choices[0].message;

    // ── Tool calls ───────────────────────────────────────────────────────────
    if (assistantMsg.tool_calls?.length > 0) {
      agentMessages.push(assistantMsg);

      // Upgrade complexity if the model runs more tools than we estimated
      if (assistantMsg.tool_calls.length >= 2 && actualComplexity === "basic") {
        actualComplexity = "tool";
      }
      if (assistantMsg.tool_calls.length >= 3) {
        actualComplexity = "deep";
      }

      logger.info(`[agent] turn ${turn + 1} — ${assistantMsg.tool_calls.length} tool call(s)`);

      const toolResults = await Promise.all(
        assistantMsg.tool_calls.map(async (tc) => {
          let args = {};
          try { args = JSON.parse(tc.function.arguments || "{}"); } catch {}
          const result = await executeTool(tc.function.name, args, userId);
          return {
            role:         "tool",
            tool_call_id: tc.id,
            content:      JSON.stringify(result),
          };
        }),
      );

      agentMessages.push(...toolResults);
      continue;
    }

    // ── Stream final answer ──────────────────────────────────────────────────
    logger.info(`[agent] turn ${turn + 1} — streaming final answer`);

    const stream = await openai.chat.completions.create({
      model:        "gpt-4o",
      messages:     agentMessages,
      tools:        toolDefinitions,
      tool_choice:  "none",
      stream:       true,
      stream_options: { include_usage: true },
      max_tokens:   900,           // focused answers stream faster
      temperature:  0.5,           // slightly lower = faster token generation
    });

    for await (const chunk of stream) {
      const delta = chunk.choices[0]?.delta?.content;
      if (delta) yield delta;

      if (chunk.usage) {
        totalInputTokens  += chunk.usage.prompt_tokens    ?? 0;
        totalOutputTokens += chunk.usage.completion_tokens ?? 0;
      }
    }

    const totalTokens = totalInputTokens + totalOutputTokens;
    logger.info(
      `[agent] done | complexity=${actualComplexity} cost=${COMPLEXITY_COST[actualComplexity]} ` +
      `input=${totalInputTokens} output=${totalOutputTokens} total=${totalTokens}`,
    );

    // ── 5. Deduct credits + log — fire-and-forget, never blocks streaming ────
    consumeUserCredits({
      userId,
      feature:      "ai",
      complexity:   actualComplexity,
      model:        "gpt-4o",
      inputTokens:  totalInputTokens,
      outputTokens: totalOutputTokens,
    }).catch((err) => {
      // Log but don't crash — user already got the response
      logger.error("[agent] credit deduction failed:", err.message);
    });

    return;
  }

  yield "I couldn't complete the analysis. Please try again.";
}

// ─── Data fetchers ────────────────────────────────────────────────────────────

export async function fetchUserProfile({ userId }) {
  try {
    const user = await db.query.users.findFirst({
      where: eq(users.id, userId),
    });
    if (!user) return { success: false, error: "User not found" };

    const resume = await db.query.resumes.findFirst({
      where: eq(resumes.userId, userId),
    });

     const hasSkills = user.skills && user.skills.length > 0;
    const hasRole = user.role && user.role.trim() !== "";
    const hasResume = resume?.text && resume.text.trim() !== "";
    const isProfileEmpty = !hasSkills && !hasRole && !hasResume;

    return {
      success: true,
      profileComplete: !isProfileEmpty,
      // ✅ Tell LLM exactly what's missing
      missingData: [
        !hasRole && "current role/title",
        !hasSkills && "skills",
        !hasResume && "resume",
      ].filter(Boolean),
      data: {
        id: user.id,
        name: user.name,
        role: user.role || null,
        experience: user.experience || null,
        skills: user.skills || [],
        bio: user.bio || null,
        resumeText: resume?.text || null,
      },
    };
  } catch (err) {
    logger.error("[fetchUserProfile]", err.message);
    return { success: false, error: "Failed to fetch user data" };
  }
}


export async function fetchMatchedJobs({ userId, limit = 10 }) {
  try {
    const matches = await db.query.jobMatches.findMany({
  where: eq(jobMatches.userId, userId),
  orderBy: desc(jobMatches.score), // 🔥 KEY FIX
  limit,
});
   // console.log("matches jobs length", matches.length);

      if (!matches.length) {
      return {
        success: true,
        hasMatches: false,
        // ✅ Tell LLM why there are no matches
        reason: "No job matches found. This usually means the user hasn't uploaded a resume or completed their profile yet.",
        data: [],
      };
    }

    // ✅ FIX: convert to number
    const jobIds = matches.map((m) => Number(m.jobSourceId));
    logger.info("jobIds", jobIds);

    const jobsData = await db.query.jobs.findMany({
      where: inArray(jobs.sourceJobId, jobIds),
    });

    logger.info("jobs data:", jobsData.length);

    return {
      success: true,
      data: matches.map((match) => {
  const job = jobsData.find(
    (j) => j.sourceJobId === Number(match.jobSourceId)
  );

  if (!job) return null;

  return {
    id: job.sourceJobId,
    title: job.title,
    company: job.company,
    location: job.location,
    skills: job.skillsTechnical,
    description: job.description?.slice(0, 300),
    matchPercent: match.matchPercent,
    missingSkills: match.missingSkills,
  };
}).filter(Boolean),
    };
  } catch (err) {
    logger.error("[fetchMatchedJobs]", err.message);
    return { success: false, error: "Failed to fetch matched jobs" };
  }
}

export async function fetchCareerProgression({ userId }) {
  try {
    const data = await getCareerInsightsService({ userId });

    const isEmpty = !data || Object.keys(data).length === 0;

    return {
      success: true,
      hasData: !isEmpty,
      reason: isEmpty
        ? "No career progression data available. User needs to complete their profile first."
        : null,
      data: data || null,
    };
  } catch (err) {
    logger.error("[fetchCareerProgression]", err.message);
    return { success: false, error: "Failed to fetch career insights" };
  }
}