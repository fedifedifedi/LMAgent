"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { db } from "@/lib/db";
import { runNextStep } from "@/lib/letters/pipeline";
import { getLetterView, type LetterView } from "@/lib/letters/view";
import { DAILY_QUOTA_LETTER_MESSAGE, LLMError, LLMRateLimitError, LLMValidationError } from "@/lib/llm";
import { fetchOffer, OfferFetchError } from "@/lib/offer/fetch-offer";
import { MAX_OFFER_CHARS, MIN_PASTED_OFFER_CHARS, normalizeText } from "@/lib/offer/text";

export type NewLetterState = {
  error?: string;
  /** Lien illisible : l'interface bascule sur l'onglet « Coller le texte ». */
  switchToPaste?: boolean;
  text?: string;
  url?: string;
};

/** Crée la lettre à partir d'une offre collée ou d'un lien (texte récupéré côté serveur), puis ouvre sa page. */
export async function createLetterAction(_previous: NewLetterState, formData: FormData): Promise<NewLetterState> {
  const profileId = String(formData.get("profileId") ?? "");
  const mode = formData.get("mode");
  const pasted = String(formData.get("text") ?? "");
  const rawUrl = String(formData.get("url") ?? "").trim();

  if (!profileId || !(await db.profile.findUnique({ where: { id: profileId }, select: { id: true } }))) {
    return { error: "Choisis un profil enregistré.", text: pasted, url: rawUrl };
  }

  let offerText: string;
  let offerUrl: string | undefined;
  if (mode === "url") {
    if (!rawUrl) return { error: "Colle le lien de l'offre.", url: rawUrl };
    try {
      ({ text: offerText, url: offerUrl } = await fetchOffer(rawUrl));
    } catch (error) {
      if (error instanceof OfferFetchError) return { error: error.message, switchToPaste: true, url: rawUrl };
      console.error("Lecture de l'offre :", error);
      return { error: "Impossible de lire cette page : colle le texte de l'offre.", switchToPaste: true, url: rawUrl };
    }
  } else {
    offerText = normalizeText(pasted);
    if (offerText.length < MIN_PASTED_OFFER_CHARS) return { error: "Le texte de l'offre est trop court : colle l'annonce complète.", text: pasted };
  }
  if (offerText.length > MAX_OFFER_CHARS) {
    return { error: `L'offre dépasse ${MAX_OFFER_CHARS.toLocaleString("fr-FR")} caractères : colle seulement l'annonce.`, text: pasted, url: rawUrl };
  }

  const letter = await db.letter.create({ data: { profileId, offerText, offerUrl }, select: { id: true } });
  revalidatePath(`/profiles/${profileId}`);
  redirect(`/letters/${letter.id}`);
}

/** Supprime la lettre (et ses appels LlmCall en cascade), puis revient à la fiche du profil. */
export async function deleteLetterAction(letterId: unknown): Promise<{ error: string } | void> {
  const id = z.string().min(1).safeParse(letterId);
  if (!id.success) return { error: "Lettre introuvable." };
  const letter = await db.letter.findUnique({ where: { id: id.data }, select: { profileId: true } });
  if (!letter) return { error: "Lettre introuvable." };
  try {
    await db.letter.delete({ where: { id: id.data } });
  } catch (error) {
    console.error("Suppression de la lettre :", error);
    return { error: "La suppression a échoué." };
  }
  revalidatePath(`/profiles/${letter.profileId}`);
  redirect(`/profiles/${letter.profileId}`);
}

export type StepActionResult ={ view: LetterView; error?: string; retryAfterSeconds?: number };

/** Exécute l'étape suivante du pipeline (appelée par la page, une étape à la fois) et renvoie l'état à jour. */
export async function runLetterStepAction(letterId: unknown): Promise<StepActionResult | { error: string }> {
  const id = z.string().min(1).safeParse(letterId);
  if (!id.success) return { error: "Lettre introuvable." };

  let error: string | undefined;
  let retryAfterSeconds: number | undefined;
  try {
    await runNextStep(id.data);
  } catch (e) {
    if (e instanceof LLMRateLimitError) {
      error = e.daily ? DAILY_QUOTA_LETTER_MESSAGE : e.message;
      retryAfterSeconds = e.retryAfterSeconds;
    } else if (e instanceof LLMValidationError) {
      error = "Le modèle n'a pas produit de réponse exploitable pour cette étape. Réessaie.";
    } else if (e instanceof LLMError) {
      error = e.message;
    } else {
      console.error("Génération de la lettre :", e);
      error = "Erreur inattendue pendant la génération. Réessaie.";
    }
  }

  const view = await getLetterView(id.data);
  if (!view) return { error: "Lettre introuvable." };
  return { view, error, retryAfterSeconds };
}
