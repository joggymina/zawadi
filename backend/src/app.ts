import express from "express";
import helmet from "helmet";
import cors from "cors";
import cookieParser from "cookie-parser";
import rateLimit from "express-rate-limit";
import { env } from "./config/env";
import { errorHandler } from "./middleware/errorHandler";
import authRoutes from "./routes/auth.routes";
import accountRoutes from "./routes/account.routes";
import loanRoutes from "./routes/loan.routes";
import adminRoutes from "./routes/admin.routes";
import settingsRoutes from "./routes/settings.routes";
import offersRoutes from "./routes/offers.routes";

export function createApp() {
  const app = express();

  app.use(helmet());
  app.use(cors({ origin: env.CORS_ORIGIN, credentials: true, exposedHeaders: ["X-Access-Token"] }));
  app.use(express.json({ limit: "100kb" }));
  app.use(cookieParser());

  // Baseline throttle across the whole API; auth routes layer a
  // stricter limiter on top of this.
  app.use(rateLimit({ windowMs: 60 * 1000, max: 120 }));

  app.get("/health", (_req, res) => res.json({ status: "ok" }));

  app.use("/api/auth", authRoutes);
  app.use("/api/account", accountRoutes);
  app.use("/api/loans", loanRoutes);
  app.use("/api/admin", adminRoutes);
  app.use("/api/settings", settingsRoutes);
  app.use("/api/offers", offersRoutes);

  app.use(errorHandler);
  return app;
}
