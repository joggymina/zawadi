-- Platform treasury for admin residual funding (not admin personal balance)
CREATE TABLE IF NOT EXISTS "PlatformAccount" (
  "id" TEXT PRIMARY KEY DEFAULT 'default',
  "principalBalance" DECIMAL(18,2) NOT NULL DEFAULT 0,
  "lifetimeInflow" DECIMAL(18,2) NOT NULL DEFAULT 0,
  "lifetimeOutflow" DECIMAL(18,2) NOT NULL DEFAULT 0,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

INSERT INTO "PlatformAccount" ("id", "principalBalance", "lifetimeInflow", "lifetimeOutflow", "updatedAt")
VALUES ('default', 0, 0, 0, CURRENT_TIMESTAMP)
ON CONFLICT ("id") DO NOTHING;
