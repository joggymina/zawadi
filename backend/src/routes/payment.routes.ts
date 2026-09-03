import { Router } from "express";
import { authenticate } from "../middleware/auth";
import { asyncHandler } from "../middleware/asyncHandler";
import { validateBody } from "../middleware/validate";
import {
  startDeposit,
  getIntent,
  payheroCallback,
  depositSchema,
} from "../controllers/payment.controller";

const router = Router();

// Public — PayHero server → your API
router.post("/payhero/callback", asyncHandler(payheroCallback));

router.use(authenticate);
router.post("/deposit", validateBody(depositSchema), asyncHandler(startDeposit));
router.get("/:id", asyncHandler(getIntent));

export default router;