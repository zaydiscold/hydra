PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;

CREATE TABLE "new_RequestLog" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "keyHash" TEXT,
    "model" TEXT NOT NULL,
    "status" INTEGER NOT NULL,
    "latencyMs" INTEGER NOT NULL,
    "promptTokens" INTEGER,
    "completionTokens" INTEGER,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "RequestLog_keyHash_fkey" FOREIGN KEY ("keyHash") REFERENCES "Key" ("hash") ON DELETE SET NULL ON UPDATE CASCADE
);

INSERT INTO "new_RequestLog" ("id", "keyHash", "model", "status", "latencyMs", "promptTokens", "completionTokens", "createdAt")
SELECT "id", "keyHash", "model", "status", "latencyMs", "promptTokens", "completionTokens", "createdAt"
FROM "RequestLog";

DROP TABLE "RequestLog";
ALTER TABLE "new_RequestLog" RENAME TO "RequestLog";

CREATE INDEX "RequestLog_createdAt_idx" ON "RequestLog"("createdAt");
CREATE INDEX "RequestLog_status_createdAt_idx" ON "RequestLog"("status", "createdAt");
CREATE INDEX "RequestLog_keyHash_createdAt_idx" ON "RequestLog"("keyHash", "createdAt");

PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
