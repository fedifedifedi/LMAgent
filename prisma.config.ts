import { defineConfig } from "prisma/config";
import { DEFAULT_DATABASE_URL } from "./lib/db-url";

export default defineConfig({
  experimental: {
    externalTables: true,
  },
  // Index FTS5 créé en SQL brut dans la migration init : Prisma ne doit ni le modéliser ni le supprimer.
  tables: {
    external: ["chunk_fts", "chunk_fts_data", "chunk_fts_idx", "chunk_fts_docsize", "chunk_fts_config"],
  },
  schema: "prisma/schema.prisma",
  migrations: {
    path: "prisma/migrations",
  },
  datasource: {
    url: process.env.DATABASE_URL ?? DEFAULT_DATABASE_URL,
  },
});
