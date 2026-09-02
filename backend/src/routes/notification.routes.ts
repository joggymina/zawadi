import { Router } from "express";
import { authenticate } from "../middleware/auth";
import { asyncHandler } from "../middleware/asyncHandler";
import { listMine, markOneRead, markAllRead } from "../controllers/notification.controller";

const router = Router();
router.use(authenticate);

router.get("/", asyncHandler(listMine));
router.post("/read-all", asyncHandler(markAllRead));
router.post("/:id/read", asyncHandler(markOneRead));

export default router;