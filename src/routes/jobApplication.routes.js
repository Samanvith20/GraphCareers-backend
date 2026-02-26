import express from "express";
import {
  upsertJobApplicationController,
  getUserJobApplicationsController,
} from "../controllers/jobAppliaction.controller.js";
import { authMiddleware } from "../middleware/auth.js";
import { userJobUpsertSchema } from "../schemas/jobs.schema.js";
import { validate } from "../middleware/validate.js";

const router = express.Router();

router.post(
  "/",
  validate(userJobUpsertSchema),
  authMiddleware,
  upsertJobApplicationController
);

router.get(
  "/",
  authMiddleware,
  getUserJobApplicationsController
);

export default router;