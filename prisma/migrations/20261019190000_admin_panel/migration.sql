-- Admin panel: admin roles, business settings, audit log, voucher limits, commission per order, wallet adjustments.
CREATE TYPE "AdminRole" AS ENUM ('SUPER', 'FINANCE', 'SUPPORT', 'CATALOG');
ALTER TYPE "WalletTxType" ADD VALUE IF NOT EXISTS 'ADJUSTMENT';
ALTER TYPE "WithdrawalStatus" ADD VALUE IF NOT EXISTS 'AWAITING_APPROVAL' BEFORE 'PENDING';

ALTER TABLE "users" ADD COLUMN "admin_role" "AdminRole";
-- Everyone who is already an admin keeps full access.
UPDATE "users" SET "admin_role" = 'SUPER' WHERE "role" = 'ADMIN';

ALTER TABLE "orders" ADD COLUMN "platform_fee" DECIMAL(14,2) NOT NULL DEFAULT 0;

ALTER TABLE "vouchers" ADD COLUMN "description" TEXT NOT NULL DEFAULT '';
ALTER TABLE "vouchers" ADD COLUMN "max_uses" INTEGER;
ALTER TABLE "vouchers" ADD COLUMN "used_count" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "vouchers" ADD COLUMN "min_order" DECIMAL(14,2);

CREATE TABLE "settings" (
    "key" TEXT NOT NULL,
    "value" JSONB NOT NULL,
    "updated_by" TEXT,
    "updated_at" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "settings_pkey" PRIMARY KEY ("key")
);

CREATE TABLE "admin_audit_logs" (
    "id" TEXT NOT NULL,
    "admin_id" TEXT NOT NULL,
    "admin_name" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "summary" TEXT NOT NULL,
    "target_id" TEXT,
    "details" JSONB NOT NULL DEFAULT '{}',
    "ip_address" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "admin_audit_logs_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "admin_audit_logs_created_at_idx" ON "admin_audit_logs"("created_at");
CREATE INDEX "admin_audit_logs_admin_id_created_at_idx" ON "admin_audit_logs"("admin_id", "created_at");

-- Speeds up the finance dashboard (paid orders by day).
CREATE INDEX "orders_status_paid_at_idx" ON "orders"("status", "paid_at");
CREATE INDEX "wallet_transactions_type_created_at_idx" ON "wallet_transactions"("type", "created_at");
