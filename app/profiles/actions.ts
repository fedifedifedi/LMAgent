"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { suggestProfileSummary } from "@/lib/agent/profile-summary";
import { db } from "@/lib/db";
import { LLMError } from "@/lib/llm";
import type { LLMUsage } from "@/lib/llm/types";
import { cleanProfileInput } from "@/lib/profile/clean";
import { deleteProfile, saveProfileFromImport, updateProfile } from "@/lib/repositories/profiles";
import { ProfileDraftSchema, ProfileSchema } from "@/lib/schemas/profile";

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

/**
 * Propose un résumé rédigé par le modèle à partir des valeurs actuelles du formulaire (non enregistrées).
 * L'utilisateur relit et modifie : rien n'est enregistré ici, sauf le coût de l'appel (LlmCall).
 */
export async function suggestSummaryAction(values: unknown, profileId?: string): Promise<{ summary: string } | { error: string }> {
  const draft = ProfileDraftSchema.safeParse(cleanProfileInput(values));
  if (!draft.success) return { error: "Complète d'abord ton profil (expériences, formation, compétences)." };
  // Le résumé actuel n'est pas transmis : la proposition repart des seuls faits du profil.
  const profileWithoutSummary = { ...draft.data, summary: undefined };

  let usage: LLMUsage | undefined;
  try {
    const summary = await suggestProfileSummary(profileWithoutSummary, { onUsage: (u) => (usage = u) });
    return { summary };
  } catch (error) {
    if (error instanceof LLMError) return { error: error.message };
    console.error("Proposition de résumé :", error);
    return { error: "Impossible de proposer un résumé pour l'instant." };
  } finally {
    if (usage) {
      await db.llmCall.create({
        data: {
          profileId: profileId ?? null,
          step: "PROFILE_SUMMARY",
          provider: usage.provider,
          model: usage.model,
          inputTokens: usage.inputTokens,
          outputTokens: usage.outputTokens,
          cacheReadTokens: usage.cacheReadTokens,
          attempts: usage.attempts,
          durationMs: usage.durationMs,
          estimated: usage.estimated ?? false,
          success: true,
        },
      });
    }
  }
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
