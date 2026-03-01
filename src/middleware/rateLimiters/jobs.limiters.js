import { RateLimiterRedis } from "rate-limiter-flexible";
import redis from "../../config/redis.js";

const baseConfig = {
  storeClient: redis,
};

// Read: fetch job applications
export const jobApplicationsReadLimiter = new RateLimiterRedis({
  ...baseConfig,
  keyPrefix: "rl:user:job-applications:read",
  points: 60,      // 60 requests
  duration: 60,    // per minute
});

// Write: upsert job application
export const jobApplicationsWriteLimiter = new RateLimiterRedis({
  ...baseConfig,
  keyPrefix: "rl:user:job-applications:write",
  points: 20,      // 20 writes
  duration: 60,
});

// Matched jobs (read-only)
export const matchedJobsLimiter = new RateLimiterRedis({
  ...baseConfig,
  keyPrefix: "rl:user:matched-jobs",
  points: 60,
  duration: 60,
});