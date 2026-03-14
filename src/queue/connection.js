import IORedis from "ioredis";

export const connection = new IORedis(
  process.env.BACKEND_REDIS_URL || "redis://redis:6379",
  {
    maxRetriesPerRequest: null,
    enableReadyCheck: false,
  }
);