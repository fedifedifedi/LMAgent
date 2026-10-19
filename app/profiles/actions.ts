"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { cleanProfileInput } from "@/lib/profile/clean";
import { deleteProfile, saveProfileFromImport, updateProfile } from "@/lib/repositories/profiles";
import { ProfileSchema } from "@/lib/schemas/profile";

export type SaveProfileResult = { error: string; issues?: Array<{ path: string; message: string }> };

const TargetSchema = z.union([z.object({ importId: z.string().min(1) }), z.object({ profileId: z.string().min(1) })]);

/**
 * Valide le profil (les données viennent du navigateur : revalidées ici), l'enregistre puis redirige vers sa fiche.
 * Ne renvoie quelque chose qu'en cas d'erreur.
 */
export async function saveProfileAction(target: unknown, values: unknown): Promise<SaveProfileResult> {
  const where = TargetSchema.safeParse(target);
  if (!where.success) return { error: "Requête invalide." };

  const parsed = ProfileSchema.safeParse(cleanProfileInput(values));
  if (!parsed.success) {
    return {
      error: "Le profil contient des erreurs : corrige les champs signalés.",
      issues: parsed.error.issues.map((issue) => ({ path: issue.path.join("."), message: issue.message })),
    };
  }

  let id: string;
  try {
    id =
      "importId" in where.data
        ? (await saveProfileFromImport(where.data.importId, parsed.data)).id
        : (await updateProfile(where.data.profileId, parsed.data)).id;
  } catch (error) {
    console.error("Enregistrement du profil :", error);
    return { error: "L'enregistrement a échoué. Réessaie dans un instant." };
  }

  revalidatePath("/profiles");
  redirect(`/profiles/${id}?saved=1`);
}

export async function deleteProfileAction(id: string): Promise<{ error: string } | void> {
  try {
    await deleteProfile(id);
  } catch (error) {
    console.error("Suppression du profil :", error);
    return { error: "La suppression a échoué." };
  }
  revalidatePath("/profiles");
  redirect("/profiles");
}
