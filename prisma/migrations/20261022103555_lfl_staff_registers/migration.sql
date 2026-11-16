-- CreateTable
CREATE TABLE "lfl_staff_months" (
    "month" DATE NOT NULL,
    "employeeNo" TEXT NOT NULL,
    "name" TEXT,
    "designation" TEXT,
    "branch" TEXT NOT NULL,
    "city" TEXT,
    "joinDate" DATE NOT NULL,
    "leaveDate" DATE,

    CONSTRAINT "lfl_staff_months_pkey" PRIMARY KEY ("month","employeeNo")
);

-- CreateTable
CREATE TABLE "lfl_branch_map" (
    "branch" TEXT NOT NULL,
    "storeKey" TEXT,
    "method" TEXT NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "lfl_branch_map_pkey" PRIMARY KEY ("branch")
);

-- CreateIndex
CREATE INDEX "lfl_staff_months_branch_idx" ON "lfl_staff_months"("branch");
