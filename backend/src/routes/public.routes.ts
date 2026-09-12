import { Router } from "express";
import { asyncHandler } from "../middleware/asyncHandler";
import { platformStats, platformActivity } from "../controllers/public.controller";

const router = Router();
router.get("/stats", asyncHandler(platformStats));
router.get("/activity", asyncHandler(platformActivity));
export default router;
