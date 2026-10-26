-- تصنيف قطاع الأعمال لصاحب العمل (طلب صاحب المشروع، 26 أكتوبر 2026)
-- AlterTable
ALTER TABLE "employers" ADD COLUMN     "business_type_id" UUID NOT NULL;

-- CreateTable
CREATE TABLE "business_types" (
    "id" UUID NOT NULL,
    "code" VARCHAR(64) NOT NULL,
    "name_ar" VARCHAR(150) NOT NULL,
    "name_en" VARCHAR(150) NOT NULL,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    "deleted_at" TIMESTAMPTZ(3),

    CONSTRAINT "business_types_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "business_types_code_key" ON "business_types"("code");

-- CreateIndex
CREATE INDEX "business_types_is_active_sort_order_idx" ON "business_types"("is_active", "sort_order");

-- CreateIndex
CREATE INDEX "employers_business_type_id_idx" ON "employers"("business_type_id");

-- AddForeignKey
ALTER TABLE "employers" ADD CONSTRAINT "employers_business_type_id_fkey" FOREIGN KEY ("business_type_id") REFERENCES "business_types"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

