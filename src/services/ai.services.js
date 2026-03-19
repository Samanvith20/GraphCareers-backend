import { Agent, Runner,setTracingDisabled  } from "@openai/agents";
import { eq, inArray } from "drizzle-orm";
import { db } from "../db/index.js";
import { users, resumes, jobMatches, jobs } from "../db/schema.js";
import { getCareerInsightsService } from "./careerProgression.service.js";
import { rewriteQuery } from "../lib/ai/rewriteQuery.js";
import { createAgentTools } from "../lib/ai/tools.js";
import { openrouter } from "../lib/openai.js";
setTracingDisabled(true); 

const SYSTEM_PROMPT = `You are a Career Intelligence AI for a job platform.

GOAL: Give accurate, personalized, actionable career guidance.

RULES:
1. TOOL USAGE
   - Greetings (hi, hello, good evening) → respond directly, NO tools
   - ANY career question → ALWAYS call getUserData first, then other tools as needed
   - Do not answer career questions without calling tools first

2. NEVER hallucinate — only use data returned by tools

3. ANSWER FORMAT for career questions:
   - Current situation (from profile data)
   - Skill gaps identified
   - Concrete action steps with timeline
   - Job recommendations if relevant

4. TONE: Professional, helpful, concise. Use bullet points.`;

// ✅ Returns an async generator that streams text chunks
export async function* chatService(messages, userId) {
  const userQuery = messages[messages.length - 1]?.content || "";
  const rewrittenQuery = await rewriteQuery(userQuery);

  // ✅ Build proper input array with full history
  // Agents SDK accepts array of {role, content} as input
  const history = messages.slice(0, -1).map((m) => ({
    role: m.role,
    content: typeof m.content === "string" ? m.content : String(m.content),
  }));

  const input = [
    ...history,
    { role: "user", content: rewrittenQuery },
  ];

  console.log("[agent] starting with input length:", input.length);
  console.log("[agent] last message:", rewrittenQuery);

  const agent = new Agent({
    name: "CareerAgent",
    model: "gpt-4o",           // ✅ OpenAI's best — tool calling is rock solid
    modelProvider: openrouter,
    instructions: SYSTEM_PROMPT,
    tools: createAgentTools(userId),
  });

  const runner = new Runner();

  // ✅ stream: true gives us a RunResultStreaming object
  const streamResult = await runner.run(agent, input, {
    maxTurns: 8,
    stream: true,
  });
  //console.log("stream result::",streamResult);

  // ✅ Iterate over streaming events
  for await (const event of streamResult) {
    // Text delta — stream to frontend
    if (event.type === "raw_model_stream_event") {
      const inner = event.data;
      if (inner?.type === "content_block_delta" || inner?.type === "output_text_delta") {
        const text = inner.delta?.text || inner.delta || "";
        if (text) yield text;
      }
    }

    // OpenAI streaming format
    if (event.type === "run_item_stream_event") {
      const item = event.item;
      if (item?.type === "message_output_item") {
        for (const content of item.content ?? []) {
          if (content.type === "output_text" && content.text) {
            yield content.text;
          }
        }
      }
    }
  }

  // ✅ Fallback — if streaming events didn't yield text, use finalOutput
  await streamResult.completed;
  const finalOutput = streamResult.finalOutput;
  if (finalOutput) {
    yield finalOutput;
  }
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

    return {
      success: true,
      data: {
        id: user.id,
        name: user.name,
        role: user.role,
        experience: user.experience,
        skills: user.skills,
        bio: user.bio,
        resumeText: resume?.text || "",
      },
    };
  } catch (err) {
    console.error("[fetchUserProfile]", err.message);
    return { success: false, error: "Failed to fetch user data" };
  }
}

export async function fetchMatchedJobs({ userId, limit = 10 }) {
  try {
    const matches = await db.query.jobMatches.findMany({
      where: eq(jobMatches.userId, userId),
      limit,
    });

    if (!matches.length) return { success: true, data: [] };

    const jobIds = matches.map((m) => m.jobId);
    const jobsData = await db.query.jobs.findMany({
      where: inArray(jobs.sourceJobId, jobIds),
    });

    const result = jobsData.map((job) => {
      const match = matches.find((m) => m.jobId === job.sourceJobId);
      return {
        id: job.sourceJobId,
        title: job.title,
        company: job.company,
        location: job.location,
        skills: job.skillsTechnical,
        description: job.description?.slice(0, 500),
        matchPercent: match?.matchPercent,
        missingSkills: match?.missingSkills,
        qualityScore: match?.qualityScore,
      };
    });

    return { success: true, data: result };
  } catch (err) {
    console.error("[fetchMatchedJobs]", err.message);
    return { success: false, error: "Failed to fetch matched jobs" };
  }
}

export async function fetchCareerProgression({ userId }) {
  try {
    const data = await getCareerInsightsService({ userId });
    return { success: true, data };
  } catch (err) {
    console.error("[fetchCareerProgression]", err.message);
    return { success: false, error: "Failed to fetch career insights" };
  }
}