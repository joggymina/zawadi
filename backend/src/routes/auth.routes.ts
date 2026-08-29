import { Router } from "express";
import rateLimit from "express-rate-limit";
import { validateBody } from "../middleware/validate";
import { register, login, refresh, logout, registerSchema, loginSchema } from "../controllers/auth.controller";

const router = Router();

// Login/register are the most valuable targets for credential stuffing —
// throttle harder here than the app-wide limiter.
const authLimiter = rateLimit({ windowMs: 15 * 60 * 1000, max: 20 });

router.post("/register", authLimiter, validateBody(registerSchema), register);
router.post("/login", authLimiter, validateBody(loginSchema), login);
router.post("/refresh", refresh);
router.post("/logout", logout);

export default router;
