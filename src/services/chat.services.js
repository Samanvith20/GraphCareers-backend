import { and, desc, eq, sql } from "drizzle-orm";
import { db } from "../db/index.js";
import {
  users,
  resumes,
  jobMatches,
  jobs,
  aiUsageLogs,
  chatSessions,
  chatMessages,
  userMemories,
} from "../db/schema.js";
import { getCareerInsightsService } from "./careerProgression.service.js";
import { toolDefinitions, executeTool } from "../lib/ai/tools.js";
import { openai } from "../lib/openai.js";
import logger from "../logger/logger.js";
import { AppError } from "../lib/AppError.js";
import { getUserAccessFromUser, consumeUserCredits } from "./userAccess.service.js";

// ─── Constants ────────────────────────────────────────────────────────────────

const COMPLEXITY_COST = { basic: 1, tool: 2, deep: 3 };

// How many past messages to load into context window per request.
// 20 = ~10 exchanges. Beyond this, older messages fall off context
// but memories still carry key facts forward.
const HISTORY_LIMIT = 20;

// Free plan: max sessions visible in sidebar
const FREE_SESSION_LIMIT = 5;

// ─── Complexity estimator (same as before) ────────────────────────────────────

function estimateComplexity(userMessage) {
  const msg = userMessage.toLowerCase();
  if (
    msg.includes("career") || msg.includes("roadmap") ||
    msg.includes("progression") || msg.includes("what should i") ||
    msg.includes("learning path") || msg.includes("skill gap")
  ) return "deep";

  if (
    msg.includes("job") || msg.includes("skill") ||
    msg.includes("my profile") || msg.includes("salary") ||
    msg.includes("company") || msg.includes("match") ||
    msg.includes("resume")
  ) return "tool";

  return "basic";
}

// ─── Build system prompt — injects user memories ──────────────────────────────

function buildSystemPrompt(memories) {
  const BASE = `You are a senior career mentor AI on a job platform. You speak like a real mentor — warm, direct, and specific. Not a chatbot.

═══════════════════════════════════════
IDENTITY & SCOPE
═══════════════════════════════════════
- You ONLY help with career-related topics:
  job searching, skill gaps, learning paths, resume advice,
  interview prep, salary negotiation, career switching.
- For ANY other topic → Say: "I'm focused on your career growth — I can't help with that, but ask me anything about your job search or skills!"
- Never reveal you are built on GPT or any AI model.

═══════════════════════════════════════
TOOL USAGE RULES
═══════════════════════════════════════
- Greetings (hi, hello) → respond warmly, NO tools
- "What is my name / skills / profile" → getUserData only
- Learning path, skill gaps → getUserData + getCareerProgression
- Job search → getUserData + getUserMatchedJobs
- Comprehensive career advice → all 3 tools
- NEVER call tools for out-of-scope questions

═══════════════════════════════════════
TONE & STYLE
═══════════════════════════════════════
- Write like a mentor who has read the user's full file
- Use their actual skills, role, experience — be specific
- Be honest about gaps. Be encouraging but realistic.
- NO generic advice. NO filler like "Great question!"
- Start answers directly — no preambles.

═══════════════════════════════════════
FORMAT
═══════════════════════════════════════
- Use markdown: ## headings, **bold**, bullet points
- For career questions: situation → insight → action
- For roadmaps: structured timeline with specific goals
- Max 3-4 sections unless user asks for detail`;

  // Only inject memory block if there are memories to inject
  if (!memories || memories.length === 0) return BASE;

  const memoryBlock = memories
    .map((m) => `- ${m.key}: ${m.value}`)
    .join("\n");

  return `${BASE}

═══════════════════════════════════════
WHAT YOU KNOW ABOUT THIS USER
(extracted from past conversations — use this to personalise every response)
═══════════════════════════════════════
${memoryBlock}

Use these facts naturally. Don't list them back. Reference them when relevant.
Example: if target_role is "data engineer", say "Since you're aiming for data engineering..." not "I see your target role is data engineer."`;
}

// ─── SESSION MANAGEMENT ───────────────────────────────────────────────────────

/**
 * Get or create a session.
 * - If sessionId provided: validate it belongs to userId, return it
 * - If null: create a new session, return the new id
 */
export async function getOrCreateSession(userId, sessionId) {
  if (sessionId) {
    const session = await db.query.chatSessions.findFirst({
      where: and(
        eq(chatSessions.id, sessionId),
        eq(chatSessions.userId, userId),
      ),
    });
    if (!session) throw new AppError("Session not found", 404);
    return session;
  }

  // Create new session
  const [newSession] = await db
    .insert(chatSessions)
    .values({ userId, title: "New chat" })
    .returning();

  logger.info("[chat] new session created", { userId, sessionId: newSession.id });
  return newSession;
}

/**
 * Load last N messages for a session — used to build context window.
 * Returns in chronological order (oldest first).
 */
export async function loadSessionHistory(sessionId) {
  const messages = await db.query.chatMessages.findMany({
    where: eq(chatMessages.sessionId, sessionId),
    orderBy: desc(chatMessages.createdAt),
    limit: HISTORY_LIMIT,
  });

  // Reverse so oldest is first (correct order for LLM context)
  return messages.reverse().map((m) => ({
    role:    m.role,
    content: m.content,
  }));
}

/**
 * Load all memories for a user — injected into system prompt every request.
 */
export async function loadUserMemories(userId) {
  return db.query.userMemories.findMany({
    where: eq(userMemories.userId, userId),
  });
}

/**
 * Save a single message to the DB.
 * Also increments session.messageCount and updates session.updatedAt.
 */
export async function saveMessage(sessionId, userId, role, content, tokensUsed = 0) {
  await db.transaction(async (tx) => {
    await tx.insert(chatMessages).values({
      sessionId,
      userId,
      role,
      content,
      tokensUsed,
    });

    await tx
      .update(chatSessions)
      .set({
        messageCount: sql`${chatSessions.messageCount} + 1`,
        updatedAt:    sql`now()`,
      })
      .where(eq(chatSessions.id, sessionId));
  });
}

/**
 * Get sessions list for sidebar.
 * Free users: last 5 sessions only.
 * Pro users: all sessions, newest first.
 */
export async function getSessionsByUser(userId, isPro) {
  return db.query.chatSessions.findMany({
    where: and(
      eq(chatSessions.userId, userId),
      eq(chatSessions.isArchived, false),
    ),
    orderBy: desc(chatSessions.updatedAt),
    limit:   isPro ? 200 : FREE_SESSION_LIMIT,
    columns: {
      id:           true,
      title:        true,
      messageCount: true,
      createdAt:    true,
      updatedAt:    true,
    },
  });
}

/**
 * Delete a session and all its messages (CASCADE handles messages).
 */
export async function deleteSession(userId, sessionId) {
  await db
    .delete(chatSessions)
    .where(and(
      eq(chatSessions.id, sessionId),
      eq(chatSessions.userId, userId),
    ));
}

// ─── MEMORY EXTRACTION ────────────────────────────────────────────────────────

/**
 * After each assistant response, run a lightweight AI call to extract
 * any new facts about the user. Upserts into user_memories by key.
 *
 * Runs fire-and-forget — never blocks the streaming response.
 * Free users: skip extraction (memory is a Pro feature).
 */
export async function extractAndStoreMemories(userId, sessionId, userMessage, assistantReply, isPro) {
  if (!isPro) return; // memory extraction is Pro-only

  try {
    const result = await openai.chat.completions.create({
      model:       "gpt-4o-mini", // cheap model — this is a background task
      max_tokens:  300,
      temperature: 0,
      messages: [
        {
          role:    "system",
          content: `You extract career facts about a user from a conversation exchange.
Return ONLY a JSON object. Keys must be snake_case. Values must be short strings.
Only extract facts that are clearly stated or strongly implied.
Return {} if nothing new to extract.

Valid keys to use:
target_role, preferred_location, weak_skills, strong_skills,
experience_level, job_search_status, salary_expectation,
preferred_company_type, learning_goal, interview_status

Example output:
{"target_role": "data engineer", "weak_skills": "kafka, spark", "preferred_location": "hyderabad or remote"}`,
        },
        {
          role:    "user",
          content: `User said: "${userMessage}"\n\nAssistant replied: "${assistantReply.slice(0, 500)}"`,
        },
      ],
    });

    const raw = result.content?.[0]?.text ?? result.choices?.[0]?.message?.content ?? "{}";

    let extracted = {};
    try {
      // Strip markdown code fences if model wraps in ```json
      const clean = raw.replace(/```json|```/g, "").trim();
      extracted = JSON.parse(clean);
    } catch {
      logger.warn("[memory] failed to parse extraction output", { raw });
      return;
    }

    const entries = Object.entries(extracted).filter(
      ([k, v]) => k && v && typeof k === "string" && typeof v === "string",
    );

    if (!entries.length) return;

    // Upsert each memory — unique on (userId, key)
    for (const [key, value] of entries) {
      await db
        .insert(userMemories)
        .values({ userId, key, value, sourceSessionId: sessionId })
        .onConflictDoUpdate({
          target: [userMemories.userId, userMemories.key],
          set: {
            value:           value,
            sourceSessionId: sessionId,
            updatedAt:       sql`now()`,
          },
        });
    }

    logger.info("[memory] extracted", { userId, count: entries.length, keys: entries.map(([k]) => k) });

  } catch (err) {
    // Never crash the main flow for memory extraction failures
    logger.error("[memory] extraction failed", { userId, error: err.message });
  }
}

// ─── TITLE GENERATION ─────────────────────────────────────────────────────────

/**
 * Generate a short title from the first user message.
 * Called once when messageCount goes from 0 → 1.
 * Fire-and-forget.
 */
async function generateSessionTitle(sessionId, firstMessage) {
  try {
    const result = await openai.chat.completions.create({
      model:       "gpt-4o-mini",
      max_tokens:  15,
      temperature: 0.3,
      messages: [
        {
          role:    "system",
          content: "Generate a very short title (max 5 words) for a chat session based on the user's first message. Return ONLY the title, no quotes, no punctuation at the end.",
        },
        { role: "user", content: firstMessage },
      ],
    });

    const title = result.choices?.[0]?.message?.content?.trim();
    if (!title) return;

    await db
      .update(chatSessions)
      .set({ title: title.slice(0, 60) }) // hard cap at 60 chars
      .where(eq(chatSessions.id, sessionId));

    logger.info("[chat] title generated", { sessionId, title });
  } catch (err) {
    logger.warn("[chat] title generation failed", { sessionId, error: err.message });
  }
}

// ─── MAIN CHAT SERVICE ────────────────────────────────────────────────────────

/**
 * Main generator — streams tokens back to the controller.
 *
 * What changed from the old version:
 *   1. Accepts sessionId (null = create new session)
 *   2. Loads history from DB instead of trusting frontend messages array
 *   3. Loads user memories + injects into system prompt
 *   4. Saves user message + assistant reply to DB
 *   5. Triggers memory extraction fire-and-forget after reply
 *   6. Triggers title generation on first message
 *   7. Yields { type: "session", sessionId } as first chunk so frontend
 *      knows which session to track (important for new sessions)
 */
export async function* chatService(userMessage, userId, sessionId = null) {

  // ── 1. Fetch user + plan ───────────────────────────────────────────────────
  const user = await db.query.users.findFirst({
    where:   eq(users.id, userId),
    columns: { id: true, credits: true, tier: true, planExpiresAt: true },
  });
  if (!user) throw new AppError("User not found", 404);

  const access = getUserAccessFromUser(user);
  const isPro  = access.plan === "pro";

  // ── 2. Credit check ────────────────────────────────────────────────────────
  const complexity    = estimateComplexity(userMessage);
  const estimatedCost = COMPLEXITY_COST[complexity];

  if (access.credits < estimatedCost) {
    const message = isPro
      ? `You've used all 100 Pro credits this month — you have ${access.credits} left. Your credits reset at the start of your next billing cycle.`
      : `This response costs ${estimatedCost} credit${estimatedCost > 1 ? "s" : ""} and you have ${access.credits} free credit${access.credits === 1 ? "" : "s"} remaining. Upgrade to Pro for 100 credits/month.`;
    throw new AppError(message, 402);
  }

  // ── 3. Get or create session ───────────────────────────────────────────────
  const session     = await getOrCreateSession(userId, sessionId);
  const isNewSession = !sessionId;

  // Yield session ID first so frontend can store it immediately
  // Controller encodes this as a special stream event
  yield { type: "session_id", sessionId: session.id };

  // ── 4. Load history + memories in parallel ─────────────────────────────────
  const [history, memories] = await Promise.all([
    loadSessionHistory(session.id),
    loadUserMemories(userId),
  ]);

  // ── 5. Save user message ───────────────────────────────────────────────────
  await saveMessage(session.id, userId, "user", userMessage);

  // Generate title from first message (fire-and-forget)
  if (isNewSession || session.messageCount === 0) {
    generateSessionTitle(session.id, userMessage).catch(() => {});
  }

  // ── 6. Build messages for LLM ─────────────────────────────────────────────
  const systemPrompt  = buildSystemPrompt(memories);
  const agentMessages = [
    { role: "system", content: systemPrompt },
    ...history, // DB history (already excludes current user message)
    { role: "user", content: userMessage },
  ];

  let totalInputTokens  = 0;
  let totalOutputTokens = 0;
  let actualComplexity  = complexity;
  const MAX_TURNS       = 6;

  // ── 7. Agentic loop ────────────────────────────────────────────────────────
  for (let turn = 0; turn < MAX_TURNS; turn++) {

    const response = await openai.chat.completions.create({
      model:       "gpt-4o",
      messages:    agentMessages,
      tools:       toolDefinitions,
      tool_choice: "auto",
      stream:      false,
      max_tokens:  1200,
    });

    if (response.usage) {
      totalInputTokens  += response.usage.prompt_tokens    ?? 0;
      totalOutputTokens += response.usage.completion_tokens ?? 0;
    }

    const assistantMsg = response.choices[0].message;

    // ── Tool calls ───────────────────────────────────────────────────────────
    if (assistantMsg.tool_calls?.length > 0) {
      agentMessages.push(assistantMsg);

      if (assistantMsg.tool_calls.length >= 2 && actualComplexity === "basic") actualComplexity = "tool";
      if (assistantMsg.tool_calls.length >= 3) actualComplexity = "deep";

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
      model:          "gpt-4o",
      messages:       agentMessages,
      tools:          toolDefinitions,
      tool_choice:    "none",
      stream:         true,
      stream_options: { include_usage: true },
      max_tokens:     900,
      temperature:    0.5,
    });

    let fullReply = "";

    for await (const chunk of stream) {
      const delta = chunk.choices[0]?.delta?.content;
      if (delta) {
        fullReply += delta;
        yield { type: "token", content: delta };
      }

      if (chunk.usage) {
        totalInputTokens  += chunk.usage.prompt_tokens    ?? 0;
        totalOutputTokens += chunk.usage.completion_tokens ?? 0;
      }
    }

    const totalTokens = totalInputTokens + totalOutputTokens;
    logger.info(
      `[agent] done | complexity=${actualComplexity} cost=${COMPLEXITY_COST[actualComplexity]} ` +
      `tokens=${totalTokens}`,
    );

    // ── 8. Save assistant reply + deduct credits (parallel, fire-and-forget) ──
    Promise.all([
      saveMessage(session.id, userId, "assistant", fullReply, totalTokens),

      consumeUserCredits({
        userId,
        feature:      "ai",
        complexity:   actualComplexity,
        model:        "gpt-4o",
        inputTokens:  totalInputTokens,
        outputTokens: totalOutputTokens,
      }),

      extractAndStoreMemories(userId, session.id, userMessage, fullReply, isPro),
    ]).catch((err) => {
      logger.error("[agent] post-response tasks failed:", err.message);
    });

    return;
  }

  yield { type: "token", content: "I couldn't complete the analysis. Please try again." };
}

// ─── DATA FETCHERS (unchanged) ────────────────────────────────────────────────

export async function fetchUserProfile({ userId }) {
  try {
    const user = await db.query.users.findFirst({ where: eq(users.id, userId) });
    if (!user) return { success: false, error: "User not found" };

    const resume = await db.query.resumes.findFirst({ where: eq(resumes.userId, userId) });

    const hasSkills  = user.skills && user.skills.length > 0;
    const hasRole    = user.role && user.role.trim() !== "";
    const hasResume  = resume?.text && resume.text.trim() !== "";

    return {
      success:         true,
      profileComplete: hasSkills || hasRole || hasResume,
      missingData:     [
        !hasRole    && "current role/title",
        !hasSkills  && "skills",
        !hasResume  && "resume",
      ].filter(Boolean),
      data: {
        id:         user.id,
        name:       user.name,
        role:       user.role    || null,
        experience: user.experience || null,
        skills:     user.skills  || [],
        bio:        user.bio     || null,
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
      where:   eq(jobMatches.userId, userId),
      orderBy: desc(jobMatches.score),
      limit,
    });

    if (!matches.length) {
      return {
        success:    true,
        hasMatches: false,
        reason:     "No job matches found. User likely hasn't completed their profile.",
        data:       [],
      };
    }

    const jobIds   = matches.map((m) => Number(m.jobSourceId));
    const jobsData = await db.query.jobs.findMany({
      where: inArray(jobs.sourceJobId, jobIds),
    });

    return {
      success: true,
      data: matches.map((match) => {
        const job = jobsData.find((j) => j.sourceJobId === Number(match.jobSourceId));
        if (!job) return null;
        return {
          id:           job.sourceJobId,
          title:        job.title,
          company:      job.company,
          location:     job.location,
          skills:       job.skillsTechnical,
          description:  job.description?.slice(0, 300),
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
    const data    = await getCareerInsightsService({ userId });
    const isEmpty = !data || Object.keys(data).length === 0;
    return {
      success: true,
      hasData: !isEmpty,
      reason:  isEmpty ? "User needs to complete profile first." : null,
      data:    data || null,
    };
  } catch (err) {
    logger.error("[fetchCareerProgression]", err.message);
    return { success: false, error: "Failed to fetch career insights" };
  }
}