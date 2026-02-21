import express from "express";
import dotenv from "dotenv";
import cors from "cors";
import cookieParser from "cookie-parser";
import authRoutes from "./routes/auth.routes.js";

dotenv.config();
console.log("RUNTIME DB URL:", process.env.DATABASE_URL);
const app = express();
const PORT = process.env.PORT ? Number(process.env.PORT) : 3000;
// CORS: allow only frontend URL
app.use(
  cors({
    origin: process.env.FRONTEND_URL,
    credentials: true,
  }),
);
app.use((req, res, next) => {
  console.log(
    `${req.method} ${req.originalUrl}`
  );
  next();
});

app.use(express.json());
app.use(cookieParser());

// Auth routes
app.use("/api/auth", authRoutes);

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
