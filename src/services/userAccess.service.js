
import { eq, sql } from "drizzle-orm";
import { db } from "../db/index.js";
import { aiUsageLogs, users } from "../db/schema.js";
import { AppError } from "../lib/AppError.js";


// ─────────────────────────────────────────────────────────────
// 🔥 CONFIG (single source of truth)
// ─────────────────────────────────────────────────────────────

const PLAN_CONFIG = {
  free: {
    jobMatchLimit: 10,
    credits: 10,
  },
  pro: {
    jobMatchLimit: 200, // you said you don’t want ternary in API → handled here
    credits: 100,
  },
};

// AI cost logic
function getAICost({ feature, complexity = "basic" }) {
  if (feature === "resume") return 2;

  if (feature === "ai") {
    if (complexity === "basic") return 1;
    if (complexity === "tool") return 2;
    if (complexity === "deep") return 3;
  }

  return 1;
}

// ─────────────────────────────────────────────────────────────
// 🔥 READ: Get user access (USED IN ALL APIs)
// ─────────────────────────────────────────────────────────────

export function getUserAccessFromUser(user) {
  if (!user) throw new AppError("User not found", 404);

  const isExpired =
    user.planExpiresAt && new Date(user.planExpiresAt) < new Date();

  const rawPlan = isExpired ? "free" : user.tier;
   console.log("rawplan",rawPlan)
  // 🔥 FIX: normalize
  const plan =
    typeof rawPlan === "string"
      ? rawPlan.toLowerCase()
      : "free";
      console.log("plan::",plan)

  const config = PLAN_CONFIG[plan] || PLAN_CONFIG.free;

  return {
    userId: user.id,
    plan,
    credits: user.credits || 0,
    jobLimit: config.jobMatchLimit,
    canUseAI: (user.credits || 0) > 0,
    canUploadResume: (user.credits || 0) >= 2,
  };
}

// ─────────────────────────────────────────────────────────────
// 🔥 WRITE: Consume credits (resume / ai)
// ─────────────────────────────────────────────────────────────

export async function consumeUserCredits({
  userId,
  feature,
  complexity = "basic",
  model = null,
  inputTokens = 0,
  outputTokens = 0,
}) {
  return await db.transaction(async (tx) => {
    const user = await tx.query.users.findFirst({
      where: eq(users.id, userId),
      columns: {
        id: true,
        credits: true,
      },
    });

    if (!user) throw new AppError("User not found", 404);

    const cost = getAICost({ feature, complexity });

    if ((user.credits || 0) < cost) {
      throw new AppError("Not enough credits", 403);
    }

    const remainingCredits = (user.credits || 0) - cost;

    await tx.update(users)
      .set({
        credits: remainingCredits,
      })
      .where(eq(users.id, userId));

    await tx.insert(aiUsageLogs).values({
      userId,
      feature,
      model,
      inputTokens,
      outputTokens,
      totalTokens: inputTokens + outputTokens,
    });

    return {
      remainingCredits,
      cost,
    };
  });
}