-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_CvImport" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "source" TEXT NOT NULL,
    "readMode" TEXT NOT NULL DEFAULT 'TEXT',
    "sourceName" TEXT,
    "text" TEXT,
    "draft" JSONB NOT NULL,
    "degraded" BOOLEAN NOT NULL,
    "issues" TEXT,
    "usage" JSONB NOT NULL,
    "profileId" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "CvImport_profileId_fkey" FOREIGN KEY ("profileId") REFERENCES "Profile" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
INSERT INTO "new_CvImport" ("createdAt", "degraded", "draft", "id", "issues", "profileId", "source", "sourceName", "text", "usage") SELECT "createdAt", "degraded", "draft", "id", "issues", "profileId", "source", "sourceName", "text", "usage" FROM "CvImport";
DROP TABLE "CvImport";
ALTER TABLE "new_CvImport" RENAME TO "CvImport";
CREATE INDEX "CvImport_profileId_idx" ON "CvImport"("profileId");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
