import { RateLimiterRedis } from "rate-limiter-flexible";
import redis from "../../config/redis.js";

/**
 * 1 trigger request per user per platform per 10 minutes.
 * Key: rl:ri:trigger:{userId}:{platform}
 * Prevents accidental double-submissions and credit exhaustion.
 */
export const resumeIntelligenceTriggerLimiter = new RateLimiterRedis({
  storeClient: redis,
  keyPrefix: "rl:ri:trigger",
  points: 1,
  duration: 600,
  blockDuration: 600,
});

/**
 * 3 delete requests per user per minute.
 * Prevents rapid delete-regenerate cycles.
 */
export const resumeIntelligenceDeleteLimiter = new RateLimiterRedis({
  storeClient: redis,
  keyPrefix: "rl:ri:delete",
  points: 3,
  duration: 60,
  blockDuration: 60,
});
