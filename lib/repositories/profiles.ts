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

export type ProfileCard = ProfileSummary & {
  headline: string;
  counts: { experiences: number; projects: number; education: number; skills: number; letters: number };
};

/** Liste des profils avec de quoi afficher une carte (titre, nombre d'éléments, lettres). */
export async function listProfileCards(): Promise<ProfileCard[]> {
  const rows = await db.profile.findMany({
    orderBy: { updatedAt: "desc" },
    include: { _count: { select: { letters: true } } },
  });
  return rows.map((row) => {
    const { data } = toRecord(row);
    return {
      id: row.id,
      name: row.name,
      updatedAt: row.updatedAt,
      headline: data.identity.headline,
      counts: {
        experiences: data.experiences.length,
        projects: data.projects.length,
        education: data.education.length,
        skills: data.skills.reduce((total, group) => total + group.items.length, 0),
        letters: row._count.letters,
      },
    };
  });
}

/**
 * Enregistre le profil issu d'un import de CV. Premier enregistrement : création du profil et liaison à l'import,
 * dans une même transaction. Import déjà lié : mise à jour du profil existant (pas de doublon).
 */
export async function saveProfileFromImport(importId: string, input: unknown): Promise<{ id: string }> {
  const data = ProfileSchema.parse(input);
  const json = data as Prisma.InputJsonObject;
  return db.$transaction(async (tx) => {
    const cvImport = await tx.cvImport.findUnique({ where: { id: importId }, select: { profileId: true } });
    if (!cvImport) throw new Error(`Import introuvable : ${importId}`);
    if (cvImport.profileId) {
      await tx.profile.update({ where: { id: cvImport.profileId }, data: { name: defaultName(data), data: json } });
      return { id: cvImport.profileId };
    }
    const profile = await tx.profile.create({ data: { name: defaultName(data), data: json }, select: { id: true } });
    await tx.cvImport.update({ where: { id: importId }, data: { profileId: profile.id } });
    return profile;
  });
}

/** Supprime le profil et, en cascade, ses lettres, documents et chunks. */
export async function deleteProfile(id: string): Promise<void> {
  await db.profile.delete({ where: { id } });
}
