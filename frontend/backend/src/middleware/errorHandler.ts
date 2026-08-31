import { Request, Response, NextFunction } from "express";
import { env } from "../config/env";

export class AppError extends Error {
  statusCode: number;
  constructor(message: string, statusCode = 400) {
    super(message);
    this.statusCode = statusCode;
  }
}

// eslint-disable-next-line @typescript-eslint/no-unused-vars
export function errorHandler(err: unknown, req: Request, res: Response, next: NextFunction) {
  if (err instanceof AppError) {
    return res.status(err.statusCode).json({ error: err.message });
  }
  // eslint-disable-next-line no-console
  console.error(err);
  const message = env.NODE_ENV === "production" ? "Internal server error" : String(err);
  return res.status(500).json({ error: message });
}
