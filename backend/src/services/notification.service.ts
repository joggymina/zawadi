import { prisma } from "../lib/prisma";
import { Prisma } from "@prisma/client";

export type NotifyInput = {
  userId: string;
  type: string;
  title: string;
  body: string;
  meta?: Record<string, unknown>;
};

export async function notify(input: NotifyInput) {
  return prisma.notification.create({
    data: {
      userId: input.userId,
      type: input.type,
      title: input.title,
      body: input.body,
      meta: (input.meta as Prisma.InputJsonValue) ?? undefined,
    },
  });
}

export async function notifyMany(inputs: NotifyInput[]) {
  if (inputs.length === 0) return;
  await prisma.notification.createMany({
    data: inputs.map((n) => ({
      userId: n.userId,
      type: n.type,
      title: n.title,
      body: n.body,
      meta: (n.meta as Prisma.InputJsonValue) ?? undefined,
    })),
  });
}

export async function listForUser(userId: string, limit = 50) {
  return prisma.notification.findMany({
    where: { userId },
    orderBy: { createdAt: "desc" },
    take: Math.min(limit, 100),
  });
}

export async function unreadCount(userId: string) {
  return prisma.notification.count({
    where: { userId, readAt: null },
  });
}

export async function markRead(userId: string, id: string) {
  return prisma.notification.updateMany({
    where: { id, userId },
    data: { readAt: new Date() },
  });
}

export async function markAllRead(userId: string) {
  return prisma.notification.updateMany({
    where: { userId, readAt: null },
    data: { readAt: new Date() },
  });
}