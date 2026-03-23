import { RateLimiterRedis } from "rate-limiter-flexible";
import redis from "../../config/redis.js";

const baseConfig = {
  storeClient: redis,
};

export const chatLimiter = new RateLimiterRedis({
  ...baseConfig,
  keyPrefix: "rl:ai:chat",
  points: 20,      // adjust based on your pricing
  duration: 60,    // per minute
});