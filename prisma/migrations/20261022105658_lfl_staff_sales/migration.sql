-- CreateTable
CREATE TABLE "lfl_staff_sales" (
    "date" DATE NOT NULL,
    "storeKey" TEXT NOT NULL,
    "staffId" TEXT NOT NULL,
    "staffName" TEXT,
    "sales" DOUBLE PRECISION NOT NULL,
    "gold" DOUBLE PRECISION NOT NULL,
    "bills" INTEGER NOT NULL,
    "units" DOUBLE PRECISION NOT NULL,

    CONSTRAINT "lfl_staff_sales_pkey" PRIMARY KEY ("date","storeKey","staffId")
);

-- CreateIndex
CREATE INDEX "lfl_staff_sales_staffId_idx" ON "lfl_staff_sales"("staffId");
