import { createClient, type Client } from "@libsql/client";
import { afterAll, beforeAll, expect, test } from "bun:test";
import { createMigratedDatabase } from "./helpers/test-db";

// Objets créés en SQL brut dans les migrations, invisibles pour Prisma. Une migration qui recrée
// Document ou Chunk (redéfinition de table SQLite) les supprime en silence : ce test le détecte.
const EXPECTED_TRIGGERS = [
  { name: "document_owner_insert", table: "Document" },
  { name: "document_owner_update", table: "Document" },
  { name: "chunk_ai", table: "Chunk" },
  { name: "chunk_ad", table: "Chunk" },
  { name: "chunk_au", table: "Chunk" },
];

let migrated: Awaited<ReturnType<typeof createMigratedDatabase>>;
let client: Client;

beforeAll(async () => {
  migrated = await createMigratedDatabase();
  client = createClient({ url: migrated.url });
});

afterAll(() => {
  client.close();
  migrated.cleanup();
});

test("tous les triggers attendus existent, sur la bonne table", async () => {
  const { rows } = await client.execute("SELECT name, tbl_name FROM sqlite_master WHERE type = 'trigger'");
  const actual = rows.map((row) => ({ name: String(row.name), table: String(row.tbl_name) }));
  for (const trigger of EXPECTED_TRIGGERS) {
    expect(actual).toContainEqual(trigger);
  }
});

test("la table virtuelle chunk_fts existe avec le tokenizer attendu", async () => {
  const { rows } = await client.execute("SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'chunk_fts'");
  expect(rows).toHaveLength(1);
  const sql = String(rows[0].sql);
  expect(sql).toContain("fts5");
  expect(sql).toContain("content = 'Chunk'");
  expect(sql).toContain("unicode61 remove_diacritics 2");
});
