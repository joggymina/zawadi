import { Router } from "express";
import { authenticate, requireAdmin } from "../middleware/auth";
import { validateBody } from "../middleware/validate";
import { asyncHandler } from "../middleware/asyncHandler";
import {
  getSettings,
  putSettings,
  listOffers,
  createOffer,
  deleteOffer,
  listPendingRepayments,
  approveRepayment,
  rejectRepayment,
  updateSettingsSchema,
  offerSchema,
} from "../controllers/admin.controller";

const router = Router();
router.use(authenticate, requireAdmin);

router.get("/settings", asyncHandler(getSettings));
router.put("/settings", validateBody(updateSettingsSchema), asyncHandler(putSettings));

router.get("/offers", asyncHandler(listOffers));
router.post("/offers", validateBody(offerSchema), asyncHandler(createOffer));
router.delete("/offers/:id", asyncHandler(deleteOffer));

router.get("/repayments/pending", asyncHandler(listPendingRepayments));
router.post("/repayments/:id/approve", asyncHandler(approveRepayment));
router.post("/repayments/:id/reject", asyncHandler(rejectRepayment));

export default router;