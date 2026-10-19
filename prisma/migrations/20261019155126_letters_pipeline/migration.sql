-- AlterTable
ALTER TABLE "Letter" ADD COLUMN "checks" JSONB;
ALTER TABLE "Letter" ADD COLUMN "critique" JSONB;
ALTER TABLE "Letter" ADD COLUMN "draft" JSONB;
ALTER TABLE "Letter" ADD COLUMN "error" TEXT;
ALTER TABLE "Letter" ADD COLUMN "match" JSONB;

-- CreateTable
CREATE TABLE "LlmCall" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "letterId" TEXT,
    "profileId" TEXT,
    "step" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "model" TEXT NOT NULL,
    "inputTokens" INTEGER NOT NULL,
    "outputTokens" INTEGER NOT NULL,
    "cacheReadTokens" INTEGER,
    "attempts" INTEGER NOT NULL,
    "durationMs" INTEGER NOT NULL,
    "estimated" BOOLEAN NOT NULL DEFAULT false,
    "success" BOOLEAN NOT NULL,
    "error" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "LlmCall_letterId_fkey" FOREIGN KEY ("letterId") REFERENCES "Letter" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateIndex
CREATE INDEX "LlmCall_letterId_idx" ON "LlmCall"("letterId");
