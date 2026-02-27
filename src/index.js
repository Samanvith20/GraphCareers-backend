import express from "express";
import dotenv from "dotenv";
import cors from "cors";
import cookieParser from "cookie-parser";
import authRoutes from "./routes/auth.routes.js";
import userRoutes from "./routes/user.routes.js";
import jobsRoutes from "./routes/jobs.routes.js"
import jobApplicationRoutes from "./routes/jobApplication.routes.js";
import careerprogressionRoutes from "./routes/careerprogression.routes.js"

dotenv.config();

const app = express();
const PORT = process.env.PORT ? Number(process.env.PORT) : 3000;
// CORS: allow only frontend URL
const allowedOrigins = process.env.FRONTEND_ORIGINS
  ?.split(",")
  .map(origin => origin.trim());

app.use(
  cors({
    origin: (origin, callback) => {
      // allow server-to-server / curl
      if (!origin) return callback(null, true);
  
      if (allowedOrigins.includes(origin)) {
        return callback(null, true);
      }

      return callback(new Error("Not allowed by CORS"));
    },
    credentials: true,
  })
);


app.use(express.json());
app.use(cookieParser());

// Auth routes
app.use("/api/auth", authRoutes);
app.use("/api/user", userRoutes);
app.use("/api/jobs",jobsRoutes)
app.use("/api/career",careerprogressionRoutes)
app.use(
  "/api/job-applications",
  jobApplicationRoutes
);

app.get("/", (req, res) => {
  res.json({ status: "ok", port: PORT });
});

app.listen(PORT, () => {
  // eslint-disable-next-line no-console
  console.log(`Server listening on port ${PORT}`);
});

process.on("unhandledRejection", (reason) => {
  // eslint-disable-next-line no-console
  console.error("Unhandled Rejection:", reason);
});

process.on("uncaughtException", (err) => {
  // eslint-disable-next-line no-console
  console.error("Uncaught Exception:", err);
  process.exit(1);
});
