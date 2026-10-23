-- CreateTable
CREATE TABLE "ComintyCharge" (
    "messageId" TEXT NOT NULL PRIMARY KEY,
    "costUsd" REAL NOT NULL,
    "inputTokens" INTEGER NOT NULL,
    "outputTokens" INTEGER NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);
