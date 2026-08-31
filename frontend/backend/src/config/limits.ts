/**
 * Soft limits by KYC status.
 * PENDING = pilot / unverified. VERIFIED = full product tier.
 * REJECTED = no money movement.
 */
export const KYC_LIMITS = {
  PENDING: {
    maxTxAmount: 5_000,
    maxBalance: 20_000,
    maxLoanAmount: 5_000,
    maxOpenLoans: 1,
  },
  VERIFIED: {
    maxTxAmount: 1_000_000,
    maxBalance: 10_000_000,
    maxLoanAmount: 1_000_000,
    maxOpenLoans: 5,
  },
} as const;

export type KycTier = keyof typeof KYC_LIMITS;