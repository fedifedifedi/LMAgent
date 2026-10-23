"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { checkLetter } from "@/lib/agent/letter-checks";
import { OfferAnalysisSchema, type ProfileMatch } from "@/lib/agent/schemas";
import { getAgentClient } from "@/lib/cominty/agent-client";
import { ComintyError } from "@/lib/cominty/errors";
import { db } from "@/lib/db";
import { AgentRunError, answerAgentRun, cancelAgentRun, startAgentRun } from "@/lib/letters/agent-run";
import { Prisma } from "@/lib/generated/prisma/client";
import { applyEdits, LetterEditsSchema, StoredLetterSchema } from "@/lib/letters/stored";
import { isLetterTemplate } from "@/lib/letters/templates";
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

type ViewResult = { view: LetterView } | { error: string };

/** Choix du template de mise en page de la lettre. */
export async function setLetterTemplateAction(letterId: unknown, template: unknown): Promise<ViewResult> {
  const id = z.string().min(1).safeParse(letterId);
  if (!id.success || !isLetterTemplate(template)) return { error: "Template inconnu." };
  await db.letter.update({ where: { id: id.data }, data: { template } });
  const view = await getLetterView(id.data);
  return view ? { view } : { error: "Lettre introuvable." };
}

/**
 * Enregistre les retouches du texte. Une phrase modifiée perd sa source (« modifiée par toi ») ; la version produite
 * par l'agent est conservée la première fois, pour pouvoir y revenir. Les vérifications (longueur...) sont refaites.
 */
export async function saveLetterEditsAction(letterId: unknown, edits: unknown): Promise<ViewResult> {
  const id = z.string().min(1).safeParse(letterId);
  const parsedEdits = LetterEditsSchema.safeParse(edits);
  if (!id.success) return { error: "Lettre introuvable." };
  if (!parsedEdits.success) return { error: parsedEdits.error.issues[0]?.message ?? "Texte invalide." };

  const letter = await db.letter.findUnique({ where: { id: id.data } });
  if (!letter?.content || !letter.analysis || !letter.match) return { error: "La lettre n'est pas encore générée." };
  const current = StoredLetterSchema.parse(letter.content);
  let next;
  try {
    next = applyEdits(current, parsedEdits.data);
  } catch (error) {
    return { error: error instanceof Error ? error.message : "Texte invalide." };
  }
  const checks = checkLetter(next, { analysis: OfferAnalysisSchema.parse(letter.analysis), match: letter.match as ProfileMatch });
  await db.letter.update({
    where: { id: id.data },
    data: {
      content: next as Prisma.InputJsonObject,
      checks: checks as unknown as Prisma.InputJsonValue,
      ...(!letter.generated && { generated: letter.content as Prisma.InputJsonObject }),
    },
  });
  const view = await getLetterView(id.data);
  return view ? { view } : { error: "Lettre introuvable." };
}

/** Annule toutes les retouches : la lettre redevient la version produite par l'agent. */
export async function revertLetterAction(letterId: unknown): Promise<ViewResult> {
  const id = z.string().min(1).safeParse(letterId);
  if (!id.success) return { error: "Lettre introuvable." };
  const letter = await db.letter.findUnique({ where: { id: id.data } });
  if (!letter?.generated || !letter.analysis || !letter.match) return { error: "Aucune version générée à restaurer." };
  const generated = StoredLetterSchema.parse(letter.generated);
  const checks = checkLetter(generated, { analysis: OfferAnalysisSchema.parse(letter.analysis), match: letter.match as ProfileMatch });
  await db.letter.update({
    where: { id: id.data },
    data: { content: generated as Prisma.InputJsonObject, generated: Prisma.DbNull, checks: checks as unknown as Prisma.InputJsonValue },
  });
  const view = await getLetterView(id.data);
  return view ? { view } : { error: "Lettre introuvable." };
}

/** Message lisible pour une erreur de l'agent (clé refusée, limite, réseau), sans jamais la clé. */
function agentErrorMessage(error: unknown): string {
  if (error instanceof AgentRunError || error instanceof ComintyError) return error.message;
  console.error("Agent Cominty :", error);
  return "Erreur inattendue en contactant l'agent. Réessaie.";
}

type RunResult = { runId: string } | { error: string };

/** Démarre l'agent Cominty sur la lettre (un seul tour : analyse, score, lettre, ajustements du CV). */
export async function startAgentRunAction(letterId: unknown): Promise<RunResult> {
  const id = z.string().min(1).safeParse(letterId);
  if (!id.success) return { error: "Lettre introuvable." };
  try {
    return { runId: await startAgentRun(id.data, getAgentClient()) };
  } catch (error) {
    const message = agentErrorMessage(error);
    await db.letter.updateMany({ where: { id: id.data, content: { equals: Prisma.DbNull } }, data: { status: "FAILED", error: message } });
    return { error: message };
  }
}

const AnswersSchema = z.array(z.object({ prompt: z.string().max(1000), answer: z.string().max(2000) })).min(1).max(5);

/** Réponses du candidat aux questions de l'agent (boutons ou texte libre). */
export async function answerAgentAction(letterId: unknown, answers: unknown): Promise<RunResult> {
  const id = z.string().min(1).safeParse(letterId);
  const parsed = AnswersSchema.safeParse(answers);
  if (!id.success) return { error: "Lettre introuvable." };
  if (!parsed.success) return { error: "Réponse invalide." };
  try {
    return { runId: await answerAgentRun(id.data, parsed.data, getAgentClient()) };
  } catch (error) {
    return { error: agentErrorMessage(error) };
  }
}

/** Arrête l'agent en cours ; la lettre peut être relancée avec « Reprendre ». */
export async function cancelAgentRunAction(letterId: unknown): Promise<ViewResult> {
  const id = z.string().min(1).safeParse(letterId);
  if (!id.success) return { error: "Lettre introuvable." };
  await cancelAgentRun(id.data, getAgentClient());
  const view = await getLetterView(id.data);
  return view ? { view } : { error: "Lettre introuvable." };
}

/** État à jour de la lettre (après la fin du flux de l'agent). */
export async function getLetterViewAction(letterId: unknown): Promise<ViewResult> {
  const id = z.string().min(1).safeParse(letterId);
  if (!id.success) return { error: "Lettre introuvable." };
  const view = await getLetterView(id.data);
  return view ? { view } : { error: "Lettre introuvable." };
}

export type StepActionResult = { view: LetterView; error?: string; retryAfterSeconds?: number };

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
