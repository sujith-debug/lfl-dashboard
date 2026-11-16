-- CreateTable
CREATE TABLE "lfl_stores" (
    "key" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "code" TEXT,
    "locationId" TEXT,
    "region" TEXT,
    "subregion" TEXT,
    "city" TEXT,
    "state" TEXT,
    "am" TEXT,
    "storeType" TEXT,
    "status" TEXT,
    "liveDate" DATE,
    "closeDate" DATE,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "lfl_stores_pkey" PRIMARY KEY ("key")
);

-- CreateTable
CREATE TABLE "lfl_store_days" (
    "storeKey" TEXT NOT NULL,
    "date" DATE NOT NULL,
    "storeName" TEXT NOT NULL,
    "region" TEXT,
    "am" TEXT,
    "city" TEXT,
    "ageBucket" TEXT,
    "cohort" TEXT,
    "lflFlag" TEXT,
    "tySales" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "lySales" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "tyGold" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "lyGold" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "tySilver" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "lySilver" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "tyBills" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "lyBills" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "tyGoldBills" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "lyGoldBills" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "tyFootfall" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "lyFootfall" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "lfl_store_days_pkey" PRIMARY KEY ("storeKey","date")
);

-- CreateTable
CREATE TABLE "lfl_inventory" (
    "snapshotDate" DATE NOT NULL,
    "storeKey" TEXT NOT NULL,
    "metal" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "units" DOUBLE PRECISION NOT NULL,

    CONSTRAINT "lfl_inventory_pkey" PRIMARY KEY ("snapshotDate","storeKey","metal","category")
);

-- CreateTable
CREATE TABLE "lfl_import_runs" (
    "id" UUID NOT NULL,
    "dataset" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "label" TEXT,
    "status" TEXT NOT NULL,
    "rows" INTEGER NOT NULL DEFAULT 0,
    "message" TEXT,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finishedAt" TIMESTAMP(3),

    CONSTRAINT "lfl_import_runs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "lfl_store_days_date_idx" ON "lfl_store_days"("date");

-- CreateIndex
CREATE INDEX "lfl_inventory_storeKey_idx" ON "lfl_inventory"("storeKey");

-- CreateIndex
CREATE INDEX "lfl_import_runs_dataset_startedAt_idx" ON "lfl_import_runs"("dataset", "startedAt");
