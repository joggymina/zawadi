import { Request, Response } from "express";
import { prisma } from "../lib/prisma";
import { hashPassword, verifyPassword, isPasswordStrongEnough } from "../utils/password";
import { signAccessToken, generateRefreshToken, hashRefreshToken } from "../utils/jwt";
import { AppError } from "../middleware/errorHandler";
import { env } from "../config/env";
import { z } from "zod";

export const registerSchema = z.object({
  username: z.string().min(3).max(32).regex(/^[a-z0-9_]+$/i, "Letters, numbers, underscores only"),
  phoneNumber: z.string().regex(/^\+254\d{9}$/, "Use format +254XXXXXXXXX"),
  password: z.string().min(10),
});

export const loginSchema = z.object({
  username: z.string(),
  password: z.string(),
});

const REFRESH_COOKIE = "refreshToken";

function refreshCookieOptions() {
  // Cross-site cookies (frontend and backend on different domains — the
  // common case with Vercel + a separate API host) require SameSite=None
  // and Secure. `SameSite=Strict`/`Lax` are silently dropped by the
  // browser on cross-site requests, which is what breaks session
  // restoration on reload once frontend and backend live on different
  // origins. Locally over http://localhost, `None` isn't usable without
  // TLS, so development falls back to `Lax`.
  const crossSite = env.NODE_ENV === "production";
  return {
    httpOnly: true,
    secure: crossSite,
    sameSite: (crossSite ? "none" : "lax") as "none" | "lax",
    maxAge: env.REFRESH_TOKEN_TTL_DAYS * 24 * 60 * 60 * 1000,
    path: "/api/auth",
  };
}

export async function register(req: Request, res: Response) {
  const { username, phoneNumber, password } = req.body as z.infer<typeof registerSchema>;

  if (!isPasswordStrongEnough(password)) {
    throw new AppError("Password must be at least 10 characters and include a letter and a number.");
  }

  const existing = await prisma.user.findFirst({ where: { OR: [{ username }, { phoneNumber }] } });
  if (existing) throw new AppError("Username or phone number is already registered.", 409);

  const passwordHash = await hashPassword(password);

  const user = await prisma.user.create({
    data: {
      username,
      phoneNumber,
      passwordHash,
      account: { create: {} },
    },
  });

  await prisma.auditLog.create({
    data: { userId: user.id, action: "USER_REGISTERED", ip: req.ip },
  });

  await issueSession(res, user.id, user.role, user.username);
  return res.status(201).json({
    id: user.id,
    username: user.username,
    role: user.role,
    kycStatus: user.kycStatus,
  });
}

export async function login(req: Request, res: Response) {
  const { username, password } = req.body as z.infer<typeof loginSchema>;

  const user = await prisma.user.findUnique({ where: { username } });
  const valid = user ? await verifyPassword(password, user.passwordHash) : false;
  if (!user || !valid) throw new AppError("Invalid username or password.", 401);

  await prisma.auditLog.create({ data: { userId: user.id, action: "USER_LOGIN", ip: req.ip } });

  await issueSession(res, user.id, user.role, user.username);
  return res.json({
    id: user.id,
    username: user.username,
    role: user.role,
    kycStatus: user.kycStatus,
  });
}

export async function refresh(req: Request, res: Response) {
  const token = req.cookies?.[REFRESH_COOKIE];
  if (!token) throw new AppError("No refresh token provided.", 401);

  const tokenHash = hashRefreshToken(token);
  const record = await prisma.refreshToken.findFirst({
    where: { tokenHash },
    include: { user: true },
  });

  if (!record || record.revokedAt || record.expiresAt < new Date()) {
    throw new AppError("Refresh token invalid or expired.", 401);
  }

  await prisma.refreshToken.update({
    where: { id: record.id },
    data: { revokedAt: new Date() },
  });
  await issueSession(res, record.user.id, record.user.role, record.user.username);

  return res.json({
    id: record.user.id,
    username: record.user.username,
    role: record.user.role,
    kycStatus: record.user.kycStatus,
  });
}

export async function logout(req: Request, res: Response) {
  const token = req.cookies?.[REFRESH_COOKIE];
  if (token) {
    const tokenHash = hashRefreshToken(token);
    await prisma.refreshToken.updateMany({
      where: { tokenHash },
      data: { revokedAt: new Date() },
    });
  }
  res.clearCookie(REFRESH_COOKIE, { path: "/api/auth" });
  return res.status(204).send();
}

async function issueSession(
  res: Response,
  userId: string,
  role: "USER" | "ADMIN",
  username: string,
) {
  const accessToken = signAccessToken({ sub: userId, role, username });

  const { token: refreshToken, hash } = generateRefreshToken();
  const expiresAt = new Date(
    Date.now() + env.REFRESH_TOKEN_TTL_DAYS * 24 * 60 * 60 * 1000,
  );
  await prisma.refreshToken.create({
    data: { userId, tokenHash: hash, expiresAt },
  });

  res.cookie(REFRESH_COOKIE, refreshToken, refreshCookieOptions());
  res.setHeader("X-Access-Token", accessToken);
}