-- Backup store for short-lived keys when Redis is unavailable or over its limit.
CREATE TABLE "kv_entries" (
    "key" TEXT NOT NULL,
    "value" TEXT NOT NULL,
    "expires_at" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "kv_entries_pkey" PRIMARY KEY ("key")
);
CREATE INDEX "kv_entries_expires_at_idx" ON "kv_entries"("expires_at");
