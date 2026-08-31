import { Router } from "express";
import { authenticate } from "../middleware/auth";
import { asyncHandler } from "../middleware/asyncHandler";
import { listOffers } from "../controllers/admin.controller";

const router = Router();
router.use(authenticate);
router.get("/", asyncHandler(listOffers));

export default router;