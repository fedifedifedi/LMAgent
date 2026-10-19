import { createClient } from "@libsql/client";
import { mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

function removeDir(dir: string) {
  try {
    rmSync(dir, { recursive: true, force: true });
  } catch {
    // Windows : libSQL garde le fichier verrouillé jusqu'à la fin du processus. Dossier temporaire, on le laisse.
  }
}

/** Crée une base SQLite temporaire sur laquelle toutes les migrations sont appliquées, dans l'ordre. */
export async function createMigratedDatabase() {
  const dir = mkdtempSync(path.join(tmpdir(), "lmagent-test-"));
  const url = `file:${path.join(dir, "test.db").replaceAll("\\", "/")}`;

  const client = createClient({ url });
  const migrationsDir = path.join(process.cwd(), "prisma", "migrations");
  const migrations = readdirSync(migrationsDir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort();
  for (const name of migrations) {
    await client.executeMultiple(readFileSync(path.join(migrationsDir, name, "migration.sql"), "utf8"));
  }
  client.close();

  return { url, cleanup: () => removeDir(dir) };
}

let shared: Promise<void> | undefined;

/**
 * Pointe DATABASE_URL sur une base migrée temporaire, partagée par tous les fichiers de test : bun test
 * les exécute dans un même processus et lib/db est un singleton créé au premier import.
 * À appeler AVANT d'importer lib/db. Chaque test crée ses propres données (ids uniques).
 */
export function setupTestDatabase(): Promise<void> {
  shared ??= createMigratedDatabase().then(({ url }) => {
    process.env.DATABASE_URL = url;
  });
  return shared;
}
