-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "username" TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "vaultSecret" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateTable
CREATE TABLE "Account" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "openRouterId" TEXT,
    "alias" TEXT NOT NULL,
    "sessionToken" TEXT NOT NULL,
    "config" TEXT,
    "userId" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Account_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Key" (
    "hash" TEXT NOT NULL PRIMARY KEY,
    "label" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "isProvisioningKey" BOOLEAN NOT NULL DEFAULT false,
    "disabled" BOOLEAN NOT NULL DEFAULT false,
    "limit" REAL,
    "limitRemaining" REAL,
    "limitReset" TEXT,
    "usage" REAL,
    "usageMonthly" REAL,
    "accountId" TEXT NOT NULL,
    CONSTRAINT "Key_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "Account" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Discovery" (
    "id" TEXT NOT NULL PRIMARY KEY DEFAULT 'singleton',
    "data" TEXT NOT NULL,
    "updatedAt" DATETIME NOT NULL
);

-- CreateIndex
CREATE UNIQUE INDEX "User_username_key" ON "User"("username");
