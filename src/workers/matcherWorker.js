import cron from "node-cron";
import { db } from "../db/index.js";
import { users } from "../db/schema.js";
import { getMatchedJobsService } from "../services/jobs.service.js";

import redis from "../config/redis.js";
import crypto from "crypto";
import logger from "../logger/logger.js";

const BATCH_SIZE = 50;

// 🔒 Redis Lock
async function acquireLock(key, ttl = 60 * 60) {
  const value = crypto.randomUUID();
  const result = await redis.set(key, value, "NX", "EX", ttl);
  return result === "OK" ? value : null;
}

async function releaseLock(key, value) {
  const current = await redis.get(key);
  if (current === value) await redis.del(key);
}

async function runMatcherWorker() {
  const lockKey = "lock:matcher";
  const lockValue = await acquireLock(lockKey, 7200);

  if (!lockValue) {
    logger.warn("⚠️ Matcher already running");
    return;
  }

  logger.info("🚀 Matcher Worker Started");

  let lastId = null;

  try {
    while (true) {
      const batchUsers = await db.query.users.findMany({
        columns: { id: true },
        limit: BATCH_SIZE,
        ...(lastId && { where: (u, { gt }) => gt(u.id, lastId) }),
        orderBy: (u, { asc }) => [asc(u.id)],
      });

      if (!batchUsers.length) break;

      await Promise.all(
        batchUsers.map(async (user) => {
          try {
            await getMatchedJobsService({ userId: user.id });
          } catch (err) {
            logger.error(`Matcher failed for user ${user.id}`, err);
          }
        })
      );

      lastId = batchUsers[batchUsers.length - 1].id;
    }

    logger.info("✅ Matcher Worker Completed");
  } finally {
    await releaseLock(lockKey, lockValue);
  }
}

//runMatcherWorker()
//⏰ Runs after scraper
cron.schedule("0 10,17,23 * * *", runMatcherWorker, {
  timezone: "Asia/Kolkata",
});