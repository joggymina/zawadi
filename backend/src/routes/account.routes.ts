import { Router } from "express";
import { authenticate } from "../middleware/auth";
import { validateBody } from "../middleware/validate";
import { asyncHandler } from "../middleware/asyncHandler";
import {
  getMe,
  getTransactions,
  invest,
  withdraw,
  amountSchema,
} from "../controllers/account.controller";
import { submitKyc, getMyKyc, submitKycSchema } from "../controllers/kyc.controller";

const router = Router();
router.use(authenticate);

router.get("/me", asyncHandler(getMe));
router.get("/transactions", asyncHandler(getTransactions));
router.post("/invest", validateBody(amountSchema), asyncHandler(invest));
router.post("/withdraw", validateBody(amountSchema), asyncHandler(withdraw));

router.get("/kyc", asyncHandler(getMyKyc));
router.post("/kyc", validateBody(submitKycSchema), asyncHandler(submitKyc));

export default router;