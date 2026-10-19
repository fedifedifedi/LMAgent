-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_Letter" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "profileId" TEXT NOT NULL,
    "offerText" TEXT NOT NULL,
    "offerUrl" TEXT,
    "language" TEXT,
    "analysis" JSONB,
    "match" JSONB,
    "draft" JSONB,
    "critique" JSONB,
    "content" JSONB,
    "generated" JSONB,
    "template" TEXT NOT NULL DEFAULT 'classique',
    "checks" JSONB,
    "status" TEXT NOT NULL DEFAULT 'DRAFT',
    "error" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "Letter_profileId_fkey" FOREIGN KEY ("profileId") REFERENCES "Profile" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
INSERT INTO "new_Letter" ("analysis", "checks", "content", "createdAt", "critique", "draft", "error", "id", "language", "match", "offerText", "offerUrl", "profileId", "status", "updatedAt") SELECT "analysis", "checks", "content", "createdAt", "critique", "draft", "error", "id", "language", "match", "offerText", "offerUrl", "profileId", "status", "updatedAt" FROM "Letter";
DROP TABLE "Letter";
ALTER TABLE "new_Letter" RENAME TO "Letter";
CREATE INDEX "Letter_profileId_idx" ON "Letter"("profileId");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
