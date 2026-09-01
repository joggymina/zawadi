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
  listUsers,
  setUserKyc,
  listPackages,
  createPackage,
  updatePackage,
  deletePackage,
  activatePackage,
  bulkSetPackageRates,
  listDefaultCandidates,
  settleDefault,
  runAllDefaultSettlements,
  updateSettingsSchema,
  offerSchema,
  // add other schemas you already export
} from "../controllers/admin.controller";
// If packages live in package.controller, import those from there instead.

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

router.get("/users", asyncHandler(listUsers));
router.patch("/users/:id/kyc", asyncHandler(setUserKyc));

router.get("/packages", asyncHandler(listPackages));
router.post("/packages", asyncHandler(createPackage));
router.put("/packages/:id", asyncHandler(updatePackage));
router.delete("/packages/:id", asyncHandler(deletePackage));
router.post("/packages/:id/activate", asyncHandler(activatePackage));
router.post("/packages/bulk-rate", asyncHandler(bulkSetPackageRates));

// Phase D
router.get("/defaults/candidates", asyncHandler(listDefaultCandidates));
router.post("/defaults/run", asyncHandler(runAllDefaultSettlements));
router.post("/loans/:id/settle-default", asyncHandler(settleDefault));

export default router;