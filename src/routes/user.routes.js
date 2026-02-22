
import { Router } from "express";


import { validate } from "../middleware/validate.js";

import { authMiddleware } from "../middleware/auth.js";
import { getUserdetails, getuserJobs, parseUserResumeWithAI, updateUserProfile, uploadUserResume, } from "../controllers/user.controller.js";
import { updateProfileSchema } from "../schemas/user.schema.js";
import multer from "multer";

const router = Router();
const upload = multer({ storage: multer.memoryStorage() });

router.get("/", authMiddleware, getUserdetails);
router.get("/job-applications", authMiddleware, getuserJobs)
router.patch("/update", validate(updateProfileSchema),authMiddleware, updateUserProfile)
router.post(
  "/resume-upload",
  authMiddleware,
  upload.single("resume"),
  uploadUserResume
);

// ✅ Resume → AI extraction → profile update
router.post(
  "/resume-parse",
  authMiddleware,
  parseUserResumeWithAI
);


export default router;
