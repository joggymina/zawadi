import { Router } from "express";
import { authenticate } from "../middleware/auth";
import { asyncHandler } from "../middleware/asyncHandler";
import { listPublicPackages } from "../controllers/package.controller";

const router = Router();
router.use(authenticate);
router.get("/", asyncHandler(listPublicPackages));
export default router;