-- Persist OpenRouter catalog rates and route-attempt telemetry for the local
-- Traffic Console. Existing rows remain valid and default to attempt 1.
ALTER TABLE "CachedModel" ADD COLUMN "promptPrice" REAL;
ALTER TABLE "CachedModel" ADD COLUMN "completionPrice" REAL;
ALTER TABLE "CachedModel" ADD COLUMN "requestPrice" REAL;

ALTER TABLE "RequestLog" ADD COLUMN "attempt" INTEGER NOT NULL DEFAULT 1;
ALTER TABLE "RequestLog" ADD COLUMN "outcome" TEXT;
ALTER TABLE "RequestLog" ADD COLUMN "totalCost" REAL;
ALTER TABLE "RequestLog" ADD COLUMN "costSource" TEXT;
