import { Router } from "express";
import { ReferralsController } from "../controllers/referrals.controller.js";
import { authMiddleware } from "../middleware/auth.js";

const router = Router();

router.use(authMiddleware);

// Endpoint to request referrals for a company (will use cache or fetch from Prospeo)
router.post("/request", ReferralsController.requestReferrals);

// Endpoint to fetch the entire user's referral dashboard
router.get("/dashboard", ReferralsController.getDashboard);

export default router;
