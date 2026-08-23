import { Router } from "express";
import { authenticate } from "../middleware/auth";
import { getSettings } from "../controllers/admin.controller";

// Read-only mirror of /api/admin/settings for regular users. Rates and
// guarantor requirements are business config, not sensitive — but only
// an admin should be able to change them, which is why the write path
// (PUT) lives exclusively under /api/admin.
const router = Router();
router.use(authenticate);
router.get("/", getSettings);

export default router;
