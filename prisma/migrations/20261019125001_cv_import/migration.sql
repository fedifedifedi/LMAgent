-- CreateTable
CREATE TABLE "CvImport" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "source" TEXT NOT NULL,
    "sourceName" TEXT,
    "text" TEXT NOT NULL,
    "draft" JSONB NOT NULL,
    "degraded" BOOLEAN NOT NULL,
    "issues" TEXT,
    "usage" JSONB NOT NULL,
    "profileId" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "CvImport_profileId_fkey" FOREIGN KEY ("profileId") REFERENCES "Profile" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateIndex
CREATE INDEX "CvImport_profileId_idx" ON "CvImport"("profileId");
