-- AddColumn
ALTER TABLE "Account" ADD COLUMN "lastKnownBalance" REAL;
ALTER TABLE "Account" ADD COLUMN "totalCredits" REAL;
ALTER TABLE "Account" ADD COLUMN "lastKnownBalanceAt" DATETIME;
