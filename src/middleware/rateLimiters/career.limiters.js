import { RateLimiterRedis } from "rate-limiter-flexible";
import redis from "../../config/redis.js";

export const careerProgressionLimiter = new RateLimiterRedis({
  storeClient: redis,
  keyPrefix: "rl:user:career-progression",
  points: 3,        // 3 requests
  duration: 60,     // per minute
  //execEvenly: true, // ✅ paced (no bursts)
});