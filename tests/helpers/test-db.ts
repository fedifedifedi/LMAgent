import { createClient } from "@libsql/client";
import { mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

/**
 * Crée une base SQLite temporaire avec toutes les migrations appliquées et pointe DATABASE_URL dessus.
 * À appeler AVANT d'importer lib/db (qui lit DATABASE_URL à l'import).
 */
export async function setupTestDatabase() {
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

  process.env.DATABASE_URL = url;

  return {
    async cleanup() {
      const { db } = await import("@/lib/db");
      await db.$disconnect();
      try {
        rmSync(dir, { recursive: true, force: true });
      } catch {
        // Windows : libSQL garde le fichier verrouillé jusqu'à la fin du processus. Dossier temporaire, on le laisse.
      }
    },
  };
}
