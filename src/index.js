import express from "express";
import dotenv from "dotenv";
import cors from "cors";
import cookieParser from "cookie-parser";
import { randomUUID } from "crypto";

import authRoutes from "./routes/auth.routes.js";
import userRoutes from "./routes/user.routes.js";
import jobsRoutes from "./routes/jobs.routes.js";
import jobApplicationRoutes from "./routes/jobApplication.routes.js";
import careerprogressionRoutes from "./routes/careerprogression.routes.js";

import { checkRedisHealth } from "./config/redis.js";
import { httpRequestDuration, register } from "./lib/metrices.js";
import logger from "./logger/logger.js";

dotenv.config();

const app = express();
const PORT = process.env.PORT ? Number(process.env.PORT) : 3000;

const allowedOrigins = process.env.FRONTEND_ORIGINS
  ?.split(",")
  .map((origin) => origin.trim());

/* ---------------- Core Middlewares ---------------- */

app.use(express.json());
app.use(cookieParser());

app.use(
  cors({
    origin: (origin, callback) => {
      if (!origin) return callback(null, true);

      if (allowedOrigins.includes(origin)) {
        return callback(null, true);
      }

      return callback(new Error("Not allowed by CORS"));
    },
    credentials: true,
  })
);

/* ---------------- Request ID + Logging ---------------- */
// Track every request individually.
app.use((req, res, next) => {
  req.requestId = randomUUID();

  logger.http("Incoming request", {
    requestId: req.requestId,
    method: req.method,
    url: req.url,
  });

  next();
});

/* ---------------- Metrics Middleware ---------------- */
// Collect numerical performance data.

// Prometheus needs numbers, not logs.
app.use((req, res, next) => {
  const end = httpRequestDuration.startTimer();

  res.on("finish", () => {
    end({
      method: req.method,
      route: req.route?.path || req.path,
      status: res.statusCode,
    });
  });

  next();
});

/* ---------------- Metrics Endpoint ---------------- */

app.get("/metrics", async (req, res) => {
  res.set("Content-Type", register.contentType);
  res.end(await register.metrics());
});

/* ---------------- Routes ---------------- */

app.use("/api/auth", authRoutes);
app.use("/api/user", userRoutes);
app.use("/api/jobs", jobsRoutes);
app.use("/api/career", careerprogressionRoutes);
app.use("/api/job-applications", jobApplicationRoutes);

app.get("/", (req, res) => {
  res.json({ status: "ok", port: PORT });
});

/* ---------------- Global Error Handler ---------------- */

// Catch unexpected failures.

app.use((err, req, res, next) => {
  logger.error("API error", {
    requestId: req.requestId,
    route: req.url,
    error: err.message,
    stack: err.stack,
  });

  res.status(500).json({ error: "Internal server error" });
});

/* ---------------- Server Bootstrap ---------------- */

async function startServer() {
  try {
    const redisHealth = await checkRedisHealth();

    if (!redisHealth.healthy) {
      logger.error("Redis health check failed", redisHealth.error);
      throw new Error("Redis initialization failed");
    }

    app.listen(PORT, () => {
      logger.info("Server started", { port: PORT });
    });
  } catch (err) {
    logger.error("Server startup failed", err);
    process.exit(1);
  }
}

startServer();

/* ---------------- Process Errors ---------------- */

process.on("unhandledRejection", (reason) => {
  logger.error("Unhandled Rejection", reason);
});

process.on("uncaughtException", (err) => {
  logger.error("Uncaught Exception", err);
  process.exit(1);
});