import { request } from "./client";
import type { AdminSettings, Offer, LoanRepayment, LoanPackage } from "./types";

export type AdminUser = {
  id: string;
  username: string;
  phoneNumber: string;
  role: "USER" | "ADMIN";
  kycStatus: "PENDING" | "VERIFIED" | "REJECTED";
  createdAt: string;
  account: { principalBalance: string; interestBalance: string } | null;
};

export function getSettings() {
  return request<AdminSettings>("/api/admin/settings");
}

export function updateSettings(
  patch: Partial<{
    investAnnualRatePct: number;
    loanAnnualRatePct: number;
    guarantorsRequired: number;
    guarantorCoverageExtraPct: number;
    withdrawFeePct: number;
    platformInterestSharePct: number;
  }>,
) {
  return request<AdminSettings>("/api/admin/settings", { method: "PUT", body: patch });
}

export function listOffers() {
  return request<Offer[]>("/api/admin/offers");
}

export function createOffer(params: { title: string; description: string }) {
  return request<Offer>("/api/admin/offers", { method: "POST", body: params });
}

export function deleteOffer(id: string) {
  return request<null>(`/api/admin/offers/${id}`, { method: "DELETE" });
}

export function listPendingRepayments() {
  return request<LoanRepayment[]>("/api/admin/repayments/pending");
}

export function approveRepayment(id: string) {
  return request<LoanRepayment>(`/api/admin/repayments/${id}/approve`, { method: "POST" });
}

export function rejectRepayment(id: string) {
  return request<LoanRepayment>(`/api/admin/repayments/${id}/reject`, { method: "POST" });
}

export function listUsers(params?: { q?: string; kyc?: string }) {
  const sp = new URLSearchParams();
  if (params?.q) sp.set("q", params.q);
  if (params?.kyc) sp.set("kyc", params.kyc);
  const qs = sp.toString();
  return request<AdminUser[]>(`/api/admin/users${qs ? `?${qs}` : ""}`);
}

export function setUserKyc(id: string, kycStatus: "PENDING" | "VERIFIED" | "REJECTED") {
  return request<{ id: string; username: string; kycStatus: string; role: string }>(
    `/api/admin/users/${id}/kyc`,
    { method: "PATCH", body: { kycStatus } },
  );
}

export function listPackages() {
  return request<LoanPackage[]>("/api/admin/packages");
}

export function createPackage(body: {
  name: string;
  durationHours: number;
  graceHours?: number;
  interestRateApr?: number;
  active?: boolean;
  sortOrder?: number;
}) {
  return request<LoanPackage>("/api/admin/packages", { method: "POST", body });
}

export function updatePackage(
  id: string,
  body: {
    name: string;
    durationHours: number;
    graceHours?: number;
    interestRateApr?: number;
    active?: boolean;
    sortOrder?: number;
  },
) {
  return request<LoanPackage>(`/api/admin/packages/${id}`, { method: "PUT", body });
}

export function deletePackage(id: string) {
  return request<LoanPackage>(`/api/admin/packages/${id}`, { method: "DELETE" });
}

export function activatePackage(id: string) {
  return request<LoanPackage>(`/api/admin/packages/${id}/activate`, { method: "POST" });
}

export function bulkSetPackageRates(interestRateApr: number) {
  return request<{ count: number; interestRateApr: number; packages: LoanPackage[] }>(
    "/api/admin/packages/bulk-rate",
    { method: "POST", body: { interestRateApr } },
  );
}

export function listDefaultCandidates() {
  return request<
    {
      id: string;
      amount: string;
      dueAt: string;
      principalOwed: string;
      interestOwed: string;
      borrower?: { id: string; username: string };
      package?: { id: string; name: string; graceHours: number } | null;
    }[]
  >("/api/admin/defaults/candidates");
}

export function settleDefault(loanId: string) {
  return request<{
    loanId: string;
    status: string;
    collected: string;
    uncollected: string;
  }>(`/api/admin/loans/${loanId}/settle-default`, { method: "POST" });
}

export function runAllDefaultSettlements() {
  return request<{ results: unknown[] }>("/api/admin/defaults/run", { method: "POST" });
}

export type PendingKycRow = {
  id: string;
  fullName: string;
  idNumber: string;
  createdAt: string;
  user: { id: string; username: string; phoneNumber: string; kycStatus: string };
};

export function listPendingKyc() {
  return request<PendingKycRow[]>("/api/admin/kyc/pending");
}

export function getKycSubmission(id: string) {
  return request<{
    id: string;
    fullName: string;
    idNumber: string;
    selfieData: string;
    idFrontData: string;
    idBackData: string;
    status: string;
    rejectReason: string | null;
    user: { id: string; username: string; phoneNumber: string; kycStatus: string };
  }>(`/api/admin/kyc/${id}`);
}

export function approveKyc(id: string) {
  return request<{ ok: boolean }>(`/api/admin/kyc/${id}/approve`, { method: "POST" });
}

export function rejectKyc(id: string, reason?: string) {
  return request<{ ok: boolean }>(`/api/admin/kyc/${id}/reject`, {
    method: "POST",
    body: { reason },
  });
}