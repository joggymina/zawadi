import { Router } from "express";
import { authenticate } from "../middleware/auth";
import { validateBody } from "../middleware/validate";
import {
  createLoan, listMarketplace, listMine, fund, repay,
  createLoanSchema, fundLoanSchema, repayLoanSchema,
} from "../controllers/loan.controller";

const router = Router();
router.use(authenticate);

router.post("/", validateBody(createLoanSchema), createLoan);
router.get("/marketplace", listMarketplace);
router.get("/mine", listMine);
router.post("/:id/fund", validateBody(fundLoanSchema), fund);
router.post("/:id/repay", validateBody(repayLoanSchema), repay);

export default router;
