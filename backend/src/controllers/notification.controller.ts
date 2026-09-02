import { Request, Response } from "express";
import * as notifications from "../services/notification.service";

export async function listMine(req: Request, res: Response) {
  const items = await notifications.listForUser(req.user!.id);
  const unread = await notifications.unreadCount(req.user!.id);
  return res.json({ items, unread });
}

export async function markOneRead(req: Request, res: Response) {
  await notifications.markRead(req.user!.id, req.params.id);
  return res.json({ ok: true });
}

export async function markAllRead(req: Request, res: Response) {
  await notifications.markAllRead(req.user!.id);
  return res.json({ ok: true });
}