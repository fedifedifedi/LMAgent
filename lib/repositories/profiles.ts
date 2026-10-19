import { db } from "@/lib/db";
import type { Prisma } from "@/lib/generated/prisma/client";
import { ProfileSchema, type Profile } from "@/lib/schemas/profile";

export type ProfileRecord = {
  id: string;
  name: string;
  data: Profile;
  createdAt: Date;
  updatedAt: Date;
};

export type ProfileSummary = Pick<ProfileRecord, "id" | "name" | "updatedAt">;

const defaultName = (profile: Profile) => `${profile.identity.firstName} ${profile.identity.lastName}`;

// Le JSON stocké est revalidé à la lecture : une donnée invalide en base doit échouer bruyamment.
function toRecord(row: { id: string; name: string; data: unknown; createdAt: Date; updatedAt: Date }): ProfileRecord {
  return { ...row, data: ProfileSchema.parse(row.data) };
}

export async function createProfile(input: unknown, name?: string): Promise<ProfileRecord> {
  const data = ProfileSchema.parse(input);
  const row = await db.profile.create({
    data: { name: name ?? defaultName(data), data: data as Prisma.InputJsonObject },
  });
  return toRecord(row);
}

export async function updateProfile(id: string, input: unknown, name?: string): Promise<ProfileRecord> {
  const data = ProfileSchema.parse(input);
  const row = await db.profile.update({
    where: { id },
    data: { name: name ?? defaultName(data), data: data as Prisma.InputJsonObject },
  });
  return toRecord(row);
}

export async function getProfile(id: string): Promise<ProfileRecord | null> {
  const row = await db.profile.findUnique({ where: { id } });
  return row ? toRecord(row) : null;
}

export async function listProfiles(): Promise<ProfileSummary[]> {
  return db.profile.findMany({
    select: { id: true, name: true, updatedAt: true },
    orderBy: { updatedAt: "desc" },
  });
}

/** Supprime le profil et, en cascade, ses lettres, documents et chunks. */
export async function deleteProfile(id: string): Promise<void> {
  await db.profile.delete({ where: { id } });
}
