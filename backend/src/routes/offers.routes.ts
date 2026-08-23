import { Router } from "express";
import { authenticate } from "../middleware/auth";
import { listOffers } from "../controllers/admin.controller";

const router = Router();
router.use(authenticate);
router.get("/", listOffers);

export default router;
