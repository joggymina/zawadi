import { request } from "./client";
import type { Loan, LoanRepayment } from "./types";

export type PendingGuarantee = {
  id: string;
  balanceAtPledge: string;
  status: string;
  loan: Loan;
};

export function createLoan(params: {
  amount: number;
  purpose?: string;
  guarantorUsernames: string[];
  packageId: string;
}) {
  return request<Loan>("/api/loans", { method: "POST", body: params });
}

export function marketplace() {
  return request<Loan[]>("/api/loans/marketplace");
}

export function mine() {
  return request<Loan[]>("/api/loans/mine");
}

export function funded() {
  return request<
    { fundingId: string; myAmount: string; fundedAt: string; loan: Loan }[]
  >("/api/loans/funded");
}

export function listPendingGuarantees() {
  return request<PendingGuarantee[]>("/api/loans/guarantees/pending");
}

export function respondGuarantor(loanId: string, accept: boolean) {
  return request<{ loanId: string; status: string }>(
    `/api/loans/${loanId}/guarantor-response`,
    { method: "POST", body: { accept } },
  );
}

export function fund(loanId: string, amount: number) {
  return request<Loan>(`/api/loans/${loanId}/fund`, { method: "POST", body: { amount } });
}

export function repay(loanId: string, amount: number) {
  return request<LoanRepayment>(`/api/loans/${loanId}/repay`, {
    method: "POST",
    body: { amount },
  });
}