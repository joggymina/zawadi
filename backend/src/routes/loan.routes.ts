import { Router } from "express";
import { authenticate } from "../middleware/auth";
import { validateBody } from "../middleware/validate";
import { asyncHandler } from "../middleware/asyncHandler";
import {
  createLoan,
  listMarketplace,
  listMine,
  fund,
  repay,
  createLoanSchema,
  fundLoanSchema,
  repayLoanSchema,
} from "../controllers/loan.controller";

const router = Router();
router.use(authenticate);

router.post("/", validateBody(createLoanSchema), asyncHandler(createLoan));
router.get("/marketplace", asyncHandler(listMarketplace));
router.get("/mine", asyncHandler(listMine));
router.post("/:id/fund", validateBody(fundLoanSchema), asyncHandler(fund));
router.post("/:id/repay", validateBody(repayLoanSchema), asyncHandler(repay));

export default router;