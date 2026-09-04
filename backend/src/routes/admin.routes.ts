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
  listDefaultCandidates,
  settleDefault,
  runAllDefaultSettlements,
  updateSettingsSchema,
  offerSchema,
  listPendingKyc,
  getKycSubmission,
  approveKycSubmission,
  rejectKycSubmission,
  rejectKycSchema,
  listFundingWindowClosed,
  extendFundingWindow,
  extendFundingSchema,
  adminFundClosedLoan,
  adminFundSchema,
} from "../controllers/admin.controller";
import {
  listAdminPackages,
  createPackage,
  updatePackage,
  deletePackage,
  activatePackage,
  bulkSetPackageRates,
  packageSchema,
  bulkRateSchema,
} from "../controllers/package.controller";

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

router.get("/kyc/pending", asyncHandler(listPendingKyc));
router.get("/kyc/:id", asyncHandler(getKycSubmission));
router.post("/kyc/:id/approve", asyncHandler(approveKycSubmission));
router.post("/kyc/:id/reject", validateBody(rejectKycSchema), asyncHandler(rejectKycSubmission));

router.get("/packages", asyncHandler(listAdminPackages));
router.post("/packages", validateBody(packageSchema), asyncHandler(createPackage));
router.put("/packages/:id", validateBody(packageSchema), asyncHandler(updatePackage));
router.delete("/packages/:id", asyncHandler(deletePackage));
router.post("/packages/:id/activate", asyncHandler(activatePackage));
router.post("/packages/bulk-rate", validateBody(bulkRateSchema), asyncHandler(bulkSetPackageRates));

router.get("/defaults/candidates", asyncHandler(listDefaultCandidates));
router.post("/defaults/run", asyncHandler(runAllDefaultSettlements));
router.post("/loans/:id/settle-default", asyncHandler(settleDefault));

router.get("/funding/closed", asyncHandler(listFundingWindowClosed));
router.post(
  "/loans/:id/extend-funding",
  validateBody(extendFundingSchema),
  asyncHandler(extendFundingWindow),
);
router.post(
  "/loans/:id/fund",
  validateBody(adminFundSchema),
  asyncHandler(adminFundClosedLoan),
);

export default router;