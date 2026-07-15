import express from "express";
import { ContactsController } from "../controllers/contacts.controller.js";
import { authMiddleware } from "../middleware/auth.js";

const router = express.Router();

router.use(authMiddleware);

router.post("/discover", ContactsController.discover);
router.post("/reveal", ContactsController.reveal);

export default router;
