import { PrismaLibSql } from "@prisma/adapter-libsql";
import { PrismaClient } from "@/lib/generated/prisma/client";
import { DEFAULT_DATABASE_URL } from "@/lib/db-url";

function createPrismaClient() {
  const adapter = new PrismaLibSql({ url: process.env.DATABASE_URL ?? DEFAULT_DATABASE_URL });
  return new PrismaClient({ adapter });
}

// Une seule instance par processus : en dev, le hot reload ré-évalue ce module.
const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

export const db = globalForPrisma.prisma ?? createPrismaClient();

if (process.env.NODE_ENV !== "production") globalForPrisma.prisma = db;
