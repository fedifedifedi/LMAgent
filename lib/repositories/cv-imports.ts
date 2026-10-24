import { db } from "@/lib/db";
import type { Prisma } from "@/lib/generated/prisma/client";
import type { CvReadMode, CvSource } from "@/lib/generated/prisma/enums";
import type { LLMUsage } from "@/lib/llm/types";
import { ProfileDraftSchema, type ProfileDraft } from "@/lib/schemas/profile";

export type CvImportRecord = {
  id: string;
  source: CvSource;
  readMode: CvReadMode;
  sourceName: string | null;
  text: string | null;
  draft: ProfileDraft;
  degraded: boolean;
  issues: string | null;
  usage: LLMUsage;
  profileId: string | null;
  createdAt: Date;
};

export async function createCvImport(input: {
  source: CvSource;
  readMode: CvReadMode;
  sourceName?: string;
  text: string | null;
  draft: ProfileDraft;
  degraded: boolean;
  issues?: string;
  usage: LLMUsage;
  extractionKey?: string;
}): Promise<{ id: string }> {
  return db.cvImport.create({
    data: {
      ...input,
      draft: input.draft as Prisma.InputJsonObject,
      usage: input.usage as Prisma.InputJsonObject,
    },
    select: { id: true },
  });
}

/**
 * Dernière extraction réussie (non dégradée) d'exactement le même texte de CV : un réimport la réutilise au lieu de
 * rappeler l'agent (instantané, gratuit). Seulement pour le texte : une image ou un scan n'a pas de texte comparable.
 */
export async function findReusableCvImport(text: string, extractionKey: string): Promise<CvImportRecord | null> {
  const row = await db.cvImport.findFirst({ where: { text, extractionKey, readMode: "TEXT", degraded: false }, orderBy: { createdAt: "desc" }, select: { id: true } });
  return row ? getCvImport(row.id) : null;
}

export async function getCvImport(id: string): Promise<CvImportRecord | null> {
  const row = await db.cvImport.findUnique({ where: { id } });
  if (!row) return null;
  return { ...row, draft: ProfileDraftSchema.parse(row.draft), usage: row.usage as LLMUsage };
}
