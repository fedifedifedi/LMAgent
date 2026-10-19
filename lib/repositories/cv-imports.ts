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

export async function getCvImport(id: string): Promise<CvImportRecord | null> {
  const row = await db.cvImport.findUnique({ where: { id } });
  if (!row) return null;
  return { ...row, draft: ProfileDraftSchema.parse(row.draft), usage: row.usage as LLMUsage };
}
