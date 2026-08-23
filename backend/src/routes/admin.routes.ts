import { Router } from "express";
import { authenticate, requireAdmin } from "../middleware/auth";
import { validateBody } from "../middleware/validate";
import {
  getSettings, putSettings, listOffers, createOffer, deleteOffer,
  listPendingRepayments, approveRepayment, rejectRepayment,
  updateSettingsSchema, offerSchema,
} from "../controllers/admin.controller";

const router = Router();
router.use(authenticate, requireAdmin);

router.get("/settings", getSettings);
router.put("/settings", validateBody(updateSettingsSchema), putSettings);

router.get("/offers", listOffers);
router.post("/offers", validateBody(offerSchema), createOffer);
router.delete("/offers/:id", deleteOffer);

router.get("/repayments/pending", listPendingRepayments);
router.post("/repayments/:id/approve", approveRepayment);
router.post("/repayments/:id/reject", rejectRepayment);

export default router;
