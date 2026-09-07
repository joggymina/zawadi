-- Run in Neon SQL Editor if not using migrate
ALTER TABLE "AdminSettings"
  ADD COLUMN IF NOT EXISTS "paymentProvider" TEXT NOT NULL DEFAULT 'HASHPAY';
