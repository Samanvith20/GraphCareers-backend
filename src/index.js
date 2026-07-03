import express from "express";
import dotenv from "dotenv";
import cors from "cors";
import cookieParser from "cookie-parser";
import { randomUUID } from "crypto";
import paymentRoutes from "./routes/payment.routes.js"
import authRoutes from "./routes/auth.routes.js";
import userRoutes from "./routes/user.routes.js";
import jobsRoutes from "./routes/jobs.routes.js";
import jobApplicationRoutes from "./routes/jobApplication.routes.js";
import careerprogressionRoutes from "./routes/careerprogression.routes.js";
import aiRoutes from "./routes/chat.routes.js";
import { checkRedisHealth } from "./config/redis.js";
import { httpRequestDuration, register } from "./lib/metrices.js";
import logger from "./logger/logger.js";
import Sentry from "./lib/sentry.js";

import resumeIntelligenceRoutes from "./routes/resumeIntelligence.routes.js";

dotenv.config();

const app = express();
const PORT = process.env.PORT ? Number(process.env.PORT) : 3000;
// setInterval(() => {
//   console.log("event loop alive", Date.now())
// }, 1000

const allowedOrigins = process.env.FRONTEND_ORIGINS
  ?.split(",")
  .map((origin) => origin.trim());

/* ---------------- Core Middlewares ---------------- */

// app.js — add webhook exclusion to existing middleware
app.use((req, res, next) => {
  const contentType = req.headers['content-type'] || '';

  // Skip multipart — multer handles it
  if (contentType.startsWith('multipart/form-data')) return next();

  // Skip webhook — needs raw Buffer for HMAC signature verification
  if (req.path === '/api/payments/webhook') return next();

  express.json({ limit: '10mb' })(req, res, next);
});
app.use(express.urlencoded({ limit: '10mb', extended: true })); // ← add this too
app.use(cookieParser());



app.use(
  cors({
    origin: (origin, callback) => {
      // Browserless clients (Postman, curl, server-to-server)
      if (!origin) return callback(null, true);

      // Allowed origin
      if (allowedOrigins.includes(origin)) return callback(null, true);

      // Blocked origin — security event worth logging
      logger.warn("CORS blocked request from unauthorized origin", { origin });
      return callback(new Error("Not allowed by CORS"));
    },
    credentials: true,
  })
);

/* ---------------- Request ID + Logging ---------------- */
// Track every request individually.
app.use((req, res, next) => {
  const requestId = randomUUID();

  req.requestId = requestId;
  res.setHeader("X-Request-ID", requestId);
  Sentry.setContext("request", {
    requestId,
    method: req.method,
    url: req.url,
  });

  // OPTIONAL: tag (better filtering)
  Sentry.setTag("requestId", requestId);

  logger.http("Incoming request", {
    requestId,
    method: req.method,
    url: req.url,
  });

  res.on("finish", () => {
    logger.http("Request completed", {
      requestId,
      status: res.statusCode,
      method: req.method,
      url: req.url,
    });
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
app.use("/api/ai",aiRoutes)
app.use("/api/payments",paymentRoutes)

app.use("/api/resume-intelligence", resumeIntelligenceRoutes);

app.get("/", (req, res) => {
  res.json({ status: "ok", port: PORT });
});

/* ---------------- Global Error Handler ---------------- */

// Catch unexpected failures.

app.use((err, req, res, next) => {
  const status = err.status || 500;

  if (err.isOperational) {
    // Expected business-rule failures (4xx) — warn level, no Sentry
    logger.warn("Operational error", {
      requestId: req.requestId,
      status,
      name:    err.name,
      message: err.message,
      method:  req.method,
      url:     req.url,
    });
    return res.status(status).json({
      error:     err.message,
      requestId: req.requestId,
    });
  }

  // Unexpected system failures — error level + Sentry
  Sentry.captureException(err);
  logger.error("Unhandled system error", {
    requestId: req.requestId,
    status,
    name:    err.name,
    message: err.message,
    stack:   err.stack,
    method:  req.method,
    url:     req.url,
  });

  return res.status(500).json({
    error:     "Something went wrong",
    requestId: req.requestId,
  });
});

/* ---------------- Server Bootstrap ---------------- */

async function startServer() {
  try {
    const redisHealth = await checkRedisHealth();

    if (!redisHealth.healthy) {
      logger.error("Redis health check failed — aborting startup", {
        error:   redisHealth.error,
        latency: redisHealth.latency,
      });
      throw new Error("Redis initialization failed");
    }

    app.listen(PORT, () => {
      logger.info("Server started", {
        port: PORT,
        env:  process.env.BACKEND_NODE_ENV || 'production',
        node: process.version,
      });
    });
  } catch (err) {
    logger.error("Server startup failed — process exiting", {
      name:    err.name,
      message: err.message,
      stack:   err.stack,
    });
    process.exit(1);
  }
}

startServer();

/* ---------------- Process Errors ---------------- */

process.on("unhandledRejection", (reason) => {
  Sentry.captureException(reason);
  logger.error("Unhandled promise rejection", {
    name:    reason?.name,
    message: reason?.message ?? String(reason),
    stack:   reason?.stack,
  });
});

process.on("uncaughtException", (err) => {
  Sentry.captureException(err);
  logger.error("Uncaught exception — process exiting", {
    name:    err.name,
    message: err.message,
    stack:   err.stack,
  });
  process.exit(1);
});