DELETE FROM "RequestLog";
DELETE FROM "Key";
DELETE FROM "Account";
DELETE FROM "Discovery";
DELETE FROM "CachedModel";

PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;

CREATE TABLE "new_User" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "username" TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "tokenVersion" INTEGER NOT NULL DEFAULT 0,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

INSERT INTO "new_User" ("id", "username", "passwordHash", "tokenVersion", "createdAt")
SELECT "id", "username", "passwordHash", 0, "createdAt"
FROM "User";

DROP TABLE "User";
ALTER TABLE "new_User" RENAME TO "User";
CREATE UNIQUE INDEX "User_username_key" ON "User"("username");

PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
