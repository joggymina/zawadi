import { Router } from "express";
import { authenticate } from "../middleware/auth";
import { validateBody } from "../middleware/validate";
import { getMe, getTransactions, invest, withdraw, amountSchema } from "../controllers/account.controller";

const router = Router();
router.use(authenticate);

router.get("/me", getMe);
router.get("/transactions", getTransactions);
router.post("/invest", validateBody(amountSchema), invest);
router.post("/withdraw", validateBody(amountSchema), withdraw);

export default router;
