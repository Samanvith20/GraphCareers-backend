import { RateLimiterRedis } from "rate-limiter-flexible";
import redis from "../../config/redis.js";

const baseConfig = {
  storeClient: redis,
};

// 💳 Payment limiter...
export const paymentLimiter = new RateLimiterRedis({
  ...baseConfig,
  keyPrefix: "rl:payment",
  points: 5,       // max 5 requests
  duration: 60,    // per minute
});


