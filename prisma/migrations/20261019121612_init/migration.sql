-- CreateTable
CREATE TABLE "Profile" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "data" JSONB NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "Letter" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "profileId" TEXT NOT NULL,
    "offerText" TEXT NOT NULL,
    "offerUrl" TEXT,
    "language" TEXT,
    "analysis" JSONB,
    "content" JSONB,
    "status" TEXT NOT NULL DEFAULT 'DRAFT',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "Letter_profileId_fkey" FOREIGN KEY ("profileId") REFERENCES "Profile" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Document" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "kind" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "sourceName" TEXT,
    "content" TEXT NOT NULL,
    "profileId" TEXT,
    "letterId" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Document_profileId_fkey" FOREIGN KEY ("profileId") REFERENCES "Profile" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "Document_letterId_fkey" FOREIGN KEY ("letterId") REFERENCES "Letter" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Chunk" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "documentId" TEXT NOT NULL,
    "index" INTEGER NOT NULL,
    "text" TEXT NOT NULL,
    CONSTRAINT "Chunk_documentId_fkey" FOREIGN KEY ("documentId") REFERENCES "Document" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateIndex
CREATE INDEX "Letter_profileId_idx" ON "Letter"("profileId");

-- CreateIndex
CREATE INDEX "Document_profileId_idx" ON "Document"("profileId");

-- CreateIndex
CREATE INDEX "Document_letterId_idx" ON "Document"("letterId");

-- CreateIndex
CREATE UNIQUE INDEX "Chunk_documentId_index_key" ON "Chunk"("documentId", "index");

-- ============================================================================
-- SQL ajouté à la main (non modélisable par Prisma). Voir l'en-tête de schema.prisma.
-- ============================================================================

-- Un Document appartient à exactement un propriétaire ; COMPANY_PAGE <=> Letter, les autres <=> Profile.
CREATE TRIGGER "document_owner_insert" BEFORE INSERT ON "Document"
WHEN (NEW."profileId" IS NULL) = (NEW."letterId" IS NULL)
  OR (NEW."kind" = 'COMPANY_PAGE') <> (NEW."letterId" IS NOT NULL)
BEGIN
  SELECT RAISE(ABORT, 'Document owner: COMPANY_PAGE must belong to a Letter only, other kinds to a Profile only');
END;

CREATE TRIGGER "document_owner_update" BEFORE UPDATE OF "kind", "profileId", "letterId" ON "Document"
WHEN (NEW."profileId" IS NULL) = (NEW."letterId" IS NULL)
  OR (NEW."kind" = 'COMPANY_PAGE') <> (NEW."letterId" IS NOT NULL)
BEGIN
  SELECT RAISE(ABORT, 'Document owner: COMPANY_PAGE must belong to a Letter only, other kinds to a Profile only');
END;

-- Index plein texte des chunks (external content : le texte reste dans Chunk).
-- unicode61 remove_diacritics 2 : insensible aux accents et à la casse, sans stemming (documents FR et EN).
CREATE VIRTUAL TABLE "chunk_fts" USING fts5(
  "text",
  content = 'Chunk',
  content_rowid = 'id',
  tokenize = 'unicode61 remove_diacritics 2'
);

CREATE TRIGGER "chunk_ai" AFTER INSERT ON "Chunk" BEGIN
  INSERT INTO "chunk_fts"(rowid, "text") VALUES (NEW."id", NEW."text");
END;

CREATE TRIGGER "chunk_ad" AFTER DELETE ON "Chunk" BEGIN
  INSERT INTO "chunk_fts"("chunk_fts", rowid, "text") VALUES ('delete', OLD."id", OLD."text");
END;

CREATE TRIGGER "chunk_au" AFTER UPDATE OF "text" ON "Chunk" BEGIN
  INSERT INTO "chunk_fts"("chunk_fts", rowid, "text") VALUES ('delete', OLD."id", OLD."text");
  INSERT INTO "chunk_fts"(rowid, "text") VALUES (NEW."id", NEW."text");
END;
