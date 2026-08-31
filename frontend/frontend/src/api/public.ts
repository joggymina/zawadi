import { request } from "./client";
import type { AdminSettings, Offer } from "./types";

// Read-only endpoints available to any authenticated user (not just
// admins) — see backend src/routes/settings.routes.ts and offers.routes.ts.
export function getPublicSettings() {
  return request<AdminSettings>("/api/settings");
}

export function getPublicOffers() {
  return request<Offer[]>("/api/offers");
}
