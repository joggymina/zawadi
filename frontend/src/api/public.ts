import { request } from "./client";
import type { AdminSettings, Offer, LoanPackage } from "./types";

export function getPublicSettings() {
  return request<AdminSettings>("/api/settings");
}

export function getPublicOffers() {
  return request<Offer[]>("/api/offers");
}

export function getPackages() {
  return request<LoanPackage[]>("/api/packages");
}
export type PlatformStats = {
  members: number;
  underManagement: string;
  loansRepaidThisMonth: number;
  loansRepaidAllTime: number;
  openForFunding: number;
  activeFundings: number;
};

export type ActivityItem = {
  kind: string;
  text: string;
  at: string;
};

export function getPlatformStats() {
  return request<PlatformStats>("/api/public/stats");
}

export function getPlatformActivity(limit = 12) {
  return request<ActivityItem[]>(`/api/public/activity?limit=${limit}`);
}
