import { Router } from "express";
import { authenticate } from "../middleware/auth";
import { asyncHandler } from "../middleware/asyncHandler";
import { getSettings } from "../controllers/admin.controller";

const router = Router();
router.use(authenticate);
router.get("/", asyncHandler(getSettings));

export default router;