import { db } from "@/lib/db";
import { DEMO_OFFER, DEMO_PROFILE, DEMO_PROFILE_NAME } from "@/lib/demo";
import { createProfile } from "@/lib/repositories/profiles";

/**
 * Lettre de démonstration : réutilise le profil fictif et sa dernière lettre s'ils existent, sinon les crée.
 * Ainsi, un clic répété ne relance pas l'agent (et ne dépense pas de crédits Cominty) : seule la première visite génère.
 */
export async function ensureDemoLetter(options: { fresh?: boolean } = {}): Promise<string> {
  const existing = await db.profile.findFirst({ where: { name: DEMO_PROFILE_NAME }, select: { id: true } });
  const profileId = existing?.id ?? (await createProfile(DEMO_PROFILE, DEMO_PROFILE_NAME)).id;
  // fresh : rejeu gratuit d'un vrai run enregistré, une nouvelle lettre à chaque clic pour revoir le direct.
  const letter = options.fresh ? null : await db.letter.findFirst({ where: { profileId }, orderBy: { createdAt: "desc" }, select: { id: true } });
  if (letter) return letter.id;
  const created = await db.letter.create({ data: { profileId, offerText: DEMO_OFFER }, select: { id: true } });
  return created.id;
}
