-- CreateTable
CREATE TABLE "store_profiles" (
    "id" UUID NOT NULL,
    "storeName" TEXT NOT NULL,
    "carpetSqft" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "store_profiles_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "store_profiles_storeName_key" ON "store_profiles"("storeName");
