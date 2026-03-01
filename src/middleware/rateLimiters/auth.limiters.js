
import { RateLimiterRedis } from "rate-limiter-flexible";
import redis from "../../config/redis.js";


const baseConfig = {
  storeClient: redis,

  execEvenly: true, // sliding window
};

export const loginLimiter = new RateLimiterRedis({
  ...baseConfig,
  keyPrefix: "rl:auth:login",
  points: 5,
  duration: 60,
});

export const signupLimiter = new RateLimiterRedis({
  ...baseConfig,
  keyPrefix: "rl:auth:signup",
  points: 3,
  duration: 60,
});

export const forgotPasswordLimiter = new RateLimiterRedis({
  ...baseConfig,
  keyPrefix: "rl:auth:forgot",
  points: 3,
  duration: 300, // 5 minutes
});
