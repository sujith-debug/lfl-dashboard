-- CreateTable
CREATE TABLE "lfl_segment_days" (
    "storeKey" TEXT NOT NULL,
    "date" DATE NOT NULL,
    "metal" TEXT NOT NULL,
    "segment" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "tySales" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "lySales" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "tyUnits" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "lyUnits" DOUBLE PRECISION NOT NULL DEFAULT 0,

    CONSTRAINT "lfl_segment_days_pkey" PRIMARY KEY ("storeKey","date","metal","segment","category")
);

-- CreateIndex
CREATE INDEX "lfl_segment_days_date_idx" ON "lfl_segment_days"("date");
