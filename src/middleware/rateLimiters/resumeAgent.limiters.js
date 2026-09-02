import { RateLimiterRedis } from "rate-limiter-flexible";
import redis from "../../config/redis.js";

const shared = { storeClient: redis };

export const resumeAgentTargetLimiter = new RateLimiterRedis({
  ...shared,
  keyPrefix: "rl:resume-agent:target",
  points: 10,
  duration: 60,
  blockDuration: 60,
});

export const resumeAgentRunLimiter = new RateLimiterRedis({
  ...shared,
  keyPrefix: "rl:resume-agent:run",
  points: 5,
  duration: 60,
  blockDuration: 60,
});

export const resumeAgentChatLimiter = new RateLimiterRedis({
  ...shared,
  keyPrefix: "rl:resume-agent:chat",
  points: 30,
  duration: 60,
  blockDuration: 60,
});

export const resumeAgentMutationLimiter = new RateLimiterRedis({
  ...shared,
  keyPrefix: "rl:resume-agent:mutation",
  points: 20,
  duration: 60,
  blockDuration: 60,
});

