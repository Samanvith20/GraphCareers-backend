import { and, desc, eq,gt, inArray, sql } from "drizzle-orm";
import { db } from "../db/index.js";
import { users, resumes, jobMatches, jobs, aiUsageLogs } from "../db/schema.js";
import { getCareerInsightsService } from "./careerProgression.service.js";
import { rewriteQuery } from "../lib/ai/rewriteQuery.js";
import { toolDefinitions, executeTool } from "../lib/ai/tools.js";
import { openrouter } from "../lib/openai.js";
import logger from "../logger/logger.js";
import { AppError } from "../lib/AppError.js";


const TIER_LIMITS = {
  free: 10000,
  pro: 200000,
  enterprise: Infinity,
};

// Rough token estimate for input messages
function estimateInputTokens(messages) {
  return messages.reduce((total, m) => {
    const text = typeof m.content === "string" ? m.content : "";
    return total + encode(text).length + 4; // 4 overhead per message
  }, 0);
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
   const user = await db.query.users.findFirst({
      where: eq(users.id, userId),
    });
     if (!user) {
      throw new AppError("user not found",404)
    }
  const last24h = new Date(Date.now() - 24 * 60 * 60 * 1000);

const usage = await db
  .select({
    total: sql`COALESCE(SUM(${aiUsageLogs.totalTokens}),0)`
  })
  .from(aiUsageLogs)
  .where(
    and(eq(aiUsageLogs.userId, userId), gt(aiUsageLogs.createdAt, last24h))
  );
  console.log("Userusage",usage)

if (Number(usage[0].total) >= TIER_LIMITS[user.tier] ?? TIER_LIMITS.free) {
  throw new AppError( "Daily limit reached for your plan", 429);
}
  const userQuery = messages[messages.length - 1]?.content || "";
  const rewrittenQuery = await rewriteQuery(userQuery);

  // ✅ Clean history — only plain string content
  const history = messages.slice(0, -1).map((m) => ({
    role: m.role,
    content: typeof m.content === "string" ? m.content : String(m.content),
  }));

  // ✅ Full message list — system + history + current query
  const agentMessages = [
    { role: "system", content: SYSTEM_PROMPT },
    ...history,
    { role: "user", content: rewrittenQuery },
  ];

  logger.info("[agent] turns:", agentMessages.length, "| query:", rewrittenQuery);
  let totalInputTokens = 0;
  let totalOutputTokens = 0;
  //let fullResponse = "";
  const MAX_TURNS = 6;

  for (let turn = 0; turn < MAX_TURNS; turn++) {

    // ─── Non-streaming call to detect tool calls ──────────────────────────
    const response = await openrouter.chat.completions.create({
      model: "gpt-4o",
      messages: agentMessages,
      tools: toolDefinitions,
      tool_choice: "auto",
      stream: false,
    });
    //console.log("response.usage",response.usage)
    if (response.usage) {
      totalInputTokens += response.usage.prompt_tokens ?? 0;
      totalOutputTokens += response.usage.completion_tokens ?? 0;
    }


    const choice = response.choices[0];
    const assistantMsg = choice.message;

    // ─── Tool calls requested ─────────────────────────────────────────────
    if (assistantMsg.tool_calls?.length > 0) {
      agentMessages.push(assistantMsg);
      logger.info(`[agent] turn ${turn + 1} — ${assistantMsg.tool_calls.length} tool call(s)`);

      const toolResults = await Promise.all(
        assistantMsg.tool_calls.map(async (tc) => {
          let args = {};
          try { args = JSON.parse(tc.function.arguments || "{}"); } catch {}
          const result = await executeTool(tc.function.name, args, userId);
          return {
            role: "tool",
            tool_call_id: tc.id,
            content: JSON.stringify(result),
          };
        })
      );

      agentMessages.push(...toolResults);
      continue; // loop — LLM reads tool results next turn
    }

    // ─── No tool calls — stream final answer ─────────────────────────────
    logger.info(`[agent] turn ${turn + 1} — streaming final answer`);

    const stream = await openrouter.chat.completions.create({
      model: "gpt-4o",
      messages: agentMessages, // history already includes tool results
      tools: toolDefinitions,
      tool_choice: "none",     // ✅ no more tool calls — just answer
      stream: true,
       stream_options: { include_usage: true },
    });

    for await (const chunk of stream) {
      const delta = chunk.choices[0]?.delta?.content;
      if (delta) yield delta;
      //console.log("usage:;",chunk.usage)
      if (chunk.usage) {
        totalInputTokens += chunk.usage.prompt_tokens ?? 0;
        totalOutputTokens += chunk.usage.completion_tokens ?? 0;
      }
    }
    const totalTokens = totalInputTokens + totalOutputTokens;
    logger.info(
      `[agent] done | inputTokens=${totalInputTokens} outputTokens=${totalOutputTokens} total=${totalTokens}`
    );

    // Non-blocking — never delay the response
    Promise.all([
      // Token usage log
      db.insert(aiUsageLogs).values({
        userId,
        feature: "chat",
        model: "gpt-4o",
        inputTokens: totalInputTokens,
        outputTokens: totalOutputTokens,
        totalTokens,
        createdAt: new Date(),
      }),
    ])

    return; // ✅ done
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