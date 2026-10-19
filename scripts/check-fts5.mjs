// Vérifie que libSQL embarque FTS5 avec le tokenizer unicode61 remove_diacritics 2 et la recherche vectorielle.
import { createClient } from "@libsql/client";

const db = createClient({ url: ":memory:" });

await db.execute("CREATE VIRTUAL TABLE t USING fts5(text, tokenize = 'unicode61 remove_diacritics 2')");
await db.batch([
  { sql: "INSERT INTO t(text) VALUES (?)", args: ["Expérience en développement full-stack avec Node.js et C++"] },
  { sql: "INSERT INTO t(text) VALUES (?)", args: ["Rapport de stage : pipeline RAG et réécriture"] },
]);

const cases = [
  ['"experience"', 1],
  ['"developpement"', 1],
  ['"REECRITURE"', 1],
  ['"node.js"', 1],
  ['"full-stack"', 1],
  ['"c++"', 1],
  ['"rag" OR "python"', 1],
  ['"python"', 0],
];

let failed = 0;
for (const [query, expected] of cases) {
  const { rows } = await db.execute({ sql: "SELECT rowid FROM t WHERE t MATCH ? ORDER BY bm25(t)", args: [query] });
  const ok = rows.length === expected;
  if (!ok) failed++;
  console.log(`${ok ? "✔" : "✘"} ${query} → ${rows.length} (attendu ${expected})`);
}

const { rows } = await db.execute("SELECT vector_extract(vector32('[1,2,3]')) AS v");
console.log(`✔ vecteurs libSQL : ${rows[0].v}`);

process.exit(failed ? 1 : 0);
