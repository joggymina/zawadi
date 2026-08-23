import { request } from "./client";
import type { Loan, LoanRepayment } from "./types";

export function createLoan(params: { amount: number; purpose?: string; guarantorUsernames: string[] }) {
  return request<Loan>("/api/loans", { method: "POST", body: params });
}

export function marketplace() {
  return request<Loan[]>("/api/loans/marketplace");
}

export function mine() {
  return request<Loan[]>("/api/loans/mine");
}

export function fund(loanId: string, amount: number) {
  return request<Loan>(`/api/loans/${loanId}/fund`, { method: "POST", body: { amount } });
}

export function repay(loanId: string, amount: number) {
  return request<LoanRepayment>(`/api/loans/${loanId}/repay`, { method: "POST", body: { amount } });
}
