import { Router } from "express";
import { authMiddleware } from "../middleware/auth.js";
import { paymentController } from "../controllers/payment.controller.js";
import express from "express";


const router=Router()

router.post("/create-order",authMiddleware,paymentController.createOrder)
router.post("/verify",authMiddleware,paymentController.verifyPayment)
router.post(
  "/webhook", paymentController.webhook);
  
export default router