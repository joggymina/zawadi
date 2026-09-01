import { Router } from "express";
import { authenticate } from "../middleware/auth";
import { validateBody } from "../middleware/validate";
import { asyncHandler } from "../middleware/asyncHandler";
import {
  createLoan,
  listMarketplace,
  listMine,
  listFunded,
  listPendingGuarantees,
  respondGuarantor,
  fund,
  repay,
  createLoanSchema,
  fundLoanSchema,
  repayLoanSchema,
  guarantorResponseSchema,
} from "../controllers/loan.controller";

const router = Router();
router.use(authenticate);

router.post("/", validateBody(createLoanSchema), asyncHandler(createLoan));
router.get("/marketplace", asyncHandler(listMarketplace));
router.get("/mine", asyncHandler(listMine));
router.get("/funded", asyncHandler(listFunded));
router.get("/guarantees/pending", asyncHandler(listPendingGuarantees));
router.post(
  "/:id/guarantor-response",
  validateBody(guarantorResponseSchema),
  asyncHandler(respondGuarantor),
);
router.post("/:id/fund", validateBody(fundLoanSchema), asyncHandler(fund));
router.post("/:id/repay", validateBody(repayLoanSchema), asyncHandler(repay));

export default router;