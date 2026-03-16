import { RateLimiterRedis } from "rate-limiter-flexible";
import redis from "../../config/redis.js";

const baseConfig = {
  storeClient: redis,
};

export const userReadLimiter = new RateLimiterRedis({
  ...baseConfig,
  keyPrefix: "rl:user:read",
  points: 100,      // 100 requests
  duration: 60,     // per minute
});

export const userWriteLimiter = new RateLimiterRedis({
  ...baseConfig,
  keyPrefix: "rl:user:write",
  points: 10,
  duration: 60, 

});

export const resumeUploadLimiter = new RateLimiterRedis({
  ...baseConfig,
  keyPrefix: "rl:user:resume-upload",
  points: 5,
  duration: 600,
  //execEvenly: true, // ✅ ADD THIS
});

