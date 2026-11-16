-- AlterTable
ALTER TABLE "lfl_stores" ADD COLUMN     "firstOrderDate" DATE,
ADD COLUMN     "latitude" DOUBLE PRECISION,
ADD COLUMN     "longitude" DOUBLE PRECISION,
ADD COLUMN     "ownership" TEXT;
