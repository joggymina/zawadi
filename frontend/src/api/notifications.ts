import { request } from "./client";

export type AppNotification = {
  id: string;
  type: string;
  title: string;
  body: string;
  meta: unknown;
  readAt: string | null;
  createdAt: string;
};

export function list() {
  return request<{ items: AppNotification[]; unread: number }>("/api/notifications");
}

export function markRead(id: string) {
  return request<{ ok: boolean }>(`/api/notifications/${id}/read`, { method: "POST" });
}

export function markAllRead() {
  return request<{ ok: boolean }>("/api/notifications/read-all", { method: "POST" });
}