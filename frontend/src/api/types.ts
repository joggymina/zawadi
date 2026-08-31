export interface AuthUser {
  id: string;
  username: string;
  role: "USER" | "ADMIN";
  kycStatus: "PENDING" | "VERIFIED" | "REJECTED";
}

export interface AccountSummary {
  principalBalance: string;
  interestBalance: string;
  totalBalance: string;
}

export type TxType =
  | "DEPOSIT"
  | "WITHDRAWAL"
  | "INTEREST"
  | "LOAN_FUND"
  | "LOAN_RETURN"
  | "LOAN_DISBURSEMENT"
  | "LOAN_REPAYMENT"
  | "ADJUSTMENT";

export interface Transaction {
  id: string;
  type: TxType;
  amount: string;
  balanceAfter: string;
  referenceId: string | null;
  note: string | null;
  createdAt: string;
}

export type LoanStatus =
  | "PENDING_GUARANTORS"
  | "OPEN"
  | "REPAYING"
  | "REPAID"
  | "DEFAULTED"
  | "CANCELLED";

export type RepaymentStatus = "PENDING" | "APPROVED" | "REJECTED";

export interface LoanGuarantor {
  id: string;
  userId: string;
  balanceAtPledge: string;
  user?: { username: string };
}

export interface LoanFunding {
  id: string;
  funderId: string;
  amount: string;
  createdAt?: string;
  funder?: { username: string };
}

export interface RepaymentDistribution {
  id: string;
  funderId: string;
  amount: string;
  funder?: { username: string };
}

export interface LoanRepayment {
  id: string;
  amount: string;
  status: RepaymentStatus;
  createdAt: string;
  distributions: RepaymentDistribution[];
  loan?: { id: string; borrower?: { username: string } };
}

export interface Loan {
  id: string;
  amount: string;
  purpose: string | null;
  interestRateApr: string;
  status: LoanStatus;
  principalOwed: string;
  interestOwed: string;
  fundedAmount: string;
  createdAt: string;
  borrower?: { username: string };
  guarantors: LoanGuarantor[];
  fundings?: LoanFunding[];
  repayments?: LoanRepayment[];
}

export interface AdminSettings {
  investAnnualRatePct: string;
  loanAnnualRatePct: string;
  guarantorsRequired: number;
  guarantorCoverageExtraPct: string;
  withdrawFeePct: string;
  platformInterestSharePct: string;
}

export interface Offer {
  id: string;
  title: string;
  description: string;
}

export interface MyFunding {
  fundingId: string;
  myAmount: string;
  fundedAt: string;
  loan: Loan;
}