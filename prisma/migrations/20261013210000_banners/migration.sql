-- CreateTable
CREATE TABLE "banners" (
    "id" TEXT NOT NULL,
    "eyebrow" TEXT,
    "title" TEXT NOT NULL,
    "highlight" TEXT,
    "subtitle" TEXT,
    "cta_label" TEXT,
    "cta_href" TEXT,
    "image_url" TEXT NOT NULL,
    "background_color" TEXT NOT NULL DEFAULT '#f8b91b',
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "starts_at" TIMESTAMP(3),
    "ends_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "banners_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "banners_is_active_sort_order_idx" ON "banners"("is_active", "sort_order");
