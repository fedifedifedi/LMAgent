-- AlterTable
ALTER TABLE "Letter" ADD COLUMN "insights" JSONB;

-- AlterTable
ALTER TABLE "LlmCall" ADD COLUMN "costUsd" REAL;

-- CreateTable
CREATE TABLE "AgentRun" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "letterId" TEXT NOT NULL,
    "threadId" TEXT NOT NULL,
    "messageId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'RUNNING',
    "questions" JSONB,
    "lastEventId" TEXT,
    "error" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finishedAt" DATETIME,
    CONSTRAINT "AgentRun_letterId_fkey" FOREIGN KEY ("letterId") REFERENCES "Letter" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "AgentEvent" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "runId" TEXT NOT NULL,
    "eventId" TEXT NOT NULL,
    "correlationId" INTEGER NOT NULL,
    "name" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "at" DATETIME NOT NULL,
    CONSTRAINT "AgentEvent_runId_fkey" FOREIGN KEY ("runId") REFERENCES "AgentRun" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateIndex
CREATE UNIQUE INDEX "AgentRun_messageId_key" ON "AgentRun"("messageId");

-- CreateIndex
CREATE INDEX "AgentRun_letterId_idx" ON "AgentRun"("letterId");

-- CreateIndex
CREATE INDEX "AgentEvent_runId_idx" ON "AgentEvent"("runId");

-- CreateIndex
CREATE UNIQUE INDEX "AgentEvent_runId_eventId_key" ON "AgentEvent"("runId", "eventId");
