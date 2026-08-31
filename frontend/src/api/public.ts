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