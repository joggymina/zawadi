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
  /** Principal locked because user accepted as guarantor on active loans */
  heldAsGuarantor?: string;
  /** principalBalance − heldAsGuarantor (what can be withdrawn / used to fund) */
  availablePrincipal?: string;
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

export interface LoanPackage {
  id: string;
  name: string;
  durationHours: number;
  graceHours: number;
  interestRateApr: string;
  active: boolean;
  sortOrder: number;
}

export interface LoanGuarantor {
  id: string;
  userId: string;
  balanceAtPledge: string;
  status?: "PENDING" | "ACCEPTED" | "DECLINED" | string;
  respondedAt?: string | null;
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
  status: LoanStatus | string;
  purpose: string | null;
  interestRateApr: string;
  principalOwed: string;
  interestOwed: string;
  fundedAmount: string;
  createdAt: string;
  packageId?: string | null;
  dueAt?: string | null;
  package?: LoanPackage | null;
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