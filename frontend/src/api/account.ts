import { request } from "./client";
import type { AccountSummary, Transaction } from "./types";

export function getMe() {
  return request<AccountSummary>("/api/account/me");
}

export function getTransactions() {
  return request<Transaction[]>("/api/account/transactions");
}

export function invest(amount: number) {
  return request<{ principalBalance: string }>("/api/account/invest", { method: "POST", body: { amount } });
}

export function withdraw(amount: number) {
  return request<{ principalBalance: string }>("/api/account/withdraw", { method: "POST", body: { amount } });
}

export type Engagement = {
  username: string;
  kycStatus: string;
  referralCount: number;
  invitePath: string;
  steps: {
    verified: boolean;
    firstDeposit: boolean;
    fundedOrGuaranteed: boolean;
    requestedLoan: boolean;
  };
  completedSteps: number;
  totalSteps: number;
};

export function getEngagement() {
  return request<Engagement>("/api/account/engagement");
}
