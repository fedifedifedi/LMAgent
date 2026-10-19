import { db } from "@/lib/db";
import { Prisma } from "@/lib/generated/prisma/client";
import type { DocumentKind } from "@/lib/generated/prisma/enums";
import { DOCUMENT_ROLE, kindsForRoles, type DocumentRole } from "@/lib/rag/roles";

export type SearchScope = { profileId: string } | { letterId: string };

export type SearchOptions = SearchScope & {
  /** Rôles autorisés. Par défaut "fact" seulement : les documents de style ne sortent que si on les demande. */
  roles?: DocumentRole[];
  limit?: number;
};

export type SearchHit = {
  chunkId: number;
  documentId: string;
  documentTitle: string;
  kind: DocumentKind;
  role: DocumentRole;
  text: string;
  /** Plus grand = plus pertinent (dans la liste d'un même retriever). */
  score: number;
};

/**
 * Un retriever renvoie des hits triés par pertinence. Aujourd'hui : BM25 (FTS5).
 * Recherche hybride prévue : un retriever vectoriel (libSQL vector_top_k sur Chunk.id) dont la liste
 * sera fusionnée avec celle de BM25 par Reciprocal Rank Fusion, activé quand un provider d'embeddings existe.
 */
export type Retriever = (terms: string[], options: SearchOptions) => Promise<SearchHit[]>;

/** Une chaîne est découpée sur les espaces ; une liste (ex. sortie d'analyzeOffer) garde chaque élément comme terme. */
export function toTerms(query: string | readonly string[]): string[] {
  const raw = typeof query === "string" ? query.split(/\s+/) : query;
  return [...new Set(raw.map((term) => term.trim()).filter(Boolean))];
}

/**
 * Requête FTS5 sûre : chaque terme devient une chaîne entre guillemets doubles (les " internes sont doublés),
 * donc les opérateurs FTS5 (AND, NEAR, *, ^, :, -, +, parenthèses) sont traités comme du texte.
 * Le tokenizer unicode61 ignore ensuite la ponctuation : "C++" cherche le jeton "c", "Node.js" la suite "node" "js".
 */
export function buildFtsQuery(terms: readonly string[]): string | null {
  if (terms.length === 0) return null;
  return terms.map((term) => `"${term.replaceAll('"', '""')}"`).join(" OR ");
}

type Bm25Row = {
  chunkId: number | bigint;
  documentId: string;
  documentTitle: string;
  kind: DocumentKind;
  text: string;
  rank: number;
};

export const bm25Search: Retriever = async (terms, options) => {
  const match = buildFtsQuery(terms);
  const kinds = kindsForRoles(options.roles ?? ["fact"]);
  if (!match || kinds.length === 0) return [];

  const owner =
    "profileId" in options
      ? Prisma.sql`d."profileId" = ${options.profileId}`
      : Prisma.sql`d."letterId" = ${options.letterId}`;

  const rows = await db.$queryRaw<Bm25Row[]>`
    SELECT c."id" AS "chunkId", c."documentId", d."title" AS "documentTitle", d."kind", c."text",
           bm25("chunk_fts") AS "rank"
    FROM "chunk_fts"
    JOIN "Chunk" c ON c."id" = "chunk_fts".rowid
    JOIN "Document" d ON d."id" = c."documentId"
    WHERE "chunk_fts" MATCH ${match}
      AND ${owner}
      AND d."kind" IN (${Prisma.join(kinds)})
    ORDER BY "rank"
    LIMIT ${options.limit ?? 10}`;

  // bm25() est négatif, plus petit = meilleur : on inverse pour un score croissant.
  return rows.map(({ rank, chunkId, ...row }) => ({
    ...row,
    chunkId: Number(chunkId),
    role: DOCUMENT_ROLE[row.kind],
    score: -rank,
  }));
};

export async function search(query: string | readonly string[], options: SearchOptions): Promise<SearchHit[]> {
  return bm25Search(toTerms(query), options);
}
