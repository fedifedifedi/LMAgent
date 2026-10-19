import type { LetterIssue } from "@/lib/agent/letter-checks";
import type { Critique, LetterContent, OfferAnalysis, ProfileMatch } from "@/lib/agent/schemas";
import { buildSourceCatalog } from "@/lib/agent/sources";
import { db } from "@/lib/db";
import type { LlmStep } from "@/lib/generated/prisma/enums";
import { nextStep, type LetterStep } from "@/lib/letters/pipeline";
import { ProfileSchema } from "@/lib/schemas/profile";

export type LetterHeader = {
  senderName: string;
  senderLines: string[];
  recipientLines: string[];
  placeAndDate: string;
};

export type UsageRow = { step: LlmStep; inputTokens: number; outputTokens: number; attempts: number; success: boolean; estimated: boolean; model: string };

/** Tout ce que la page de la lettre affiche, sérialisable pour le navigateur. */
export type LetterView = {
  id: string;
  profileId: string;
  profileName: string;
  status: "DRAFT" | "GENERATED" | "FAILED" | "FINAL";
  error: string | null;
  offerText: string;
  offerUrl: string | null;
  next: LetterStep | null;
  analysis: OfferAnalysis | null;
  match: ProfileMatch | null;
  critique: Critique | null;
  /** Première version écrite (avant la critique). */
  hasDraft: boolean;
  letter: LetterContent | null;
  checks: LetterIssue[];
  header: LetterHeader;
  sources: Record<string, string>;
  /** Compétences de l'offre trouvées dans le profil : surlignées à la demande. */
  highlightTerms: string[];
  usage: UsageRow[];
};

function formatDate(date: Date, language: "fr" | "en") {
  return date.toLocaleDateString(language === "fr" ? "fr-FR" : "en-GB", { day: "numeric", month: "long", year: "numeric" });
}

export async function getLetterView(id: string): Promise<LetterView | null> {
  const letter = await db.letter.findUnique({
    where: { id },
    include: { profile: true, llmCalls: { orderBy: { createdAt: "asc" } } },
  });
  if (!letter) return null;

  const profile = ProfileSchema.parse(letter.profile.data);
  const analysis = (letter.analysis as OfferAnalysis | null) ?? null;
  const match = (letter.match as ProfileMatch | null) ?? null;
  const language = analysis?.language ?? "fr";
  const name = `${profile.identity.firstName} ${profile.identity.lastName}`;
  const city = profile.contact.city;
  const date = formatDate(letter.createdAt, language);

  return {
    id: letter.id,
    profileId: letter.profileId,
    profileName: letter.profile.name,
    status: letter.status,
    error: letter.error,
    offerText: letter.offerText,
    offerUrl: letter.offerUrl,
    next: nextStep(letter),
    analysis,
    match,
    critique: (letter.critique as Critique | null) ?? null,
    hasDraft: Boolean(letter.draft),
    letter: (letter.content as LetterContent | null) ?? null,
    checks: (letter.checks as LetterIssue[] | null) ?? [],
    header: {
      senderName: name,
      senderLines: [city, profile.contact.email, profile.contact.phone].filter((line): line is string => Boolean(line)),
      recipientLines: [analysis?.contact ? `À l'attention de ${analysis.contact.name}` : undefined, analysis?.company, analysis?.location]
        .filter((line): line is string => Boolean(line))
        .map((line) => (language === "en" && line.startsWith("À l'attention de ") ? line.replace("À l'attention de ", "For the attention of ") : line)),
      placeAndDate: language === "fr" ? `${city ? `${city}, le ` : "Le "}${date}` : city ? `${city}, ${date}` : date,
    },
    sources: Object.fromEntries(buildSourceCatalog(profile).map((entry) => [entry.id, entry.label])),
    highlightTerms: (match?.requirements ?? []).filter((r) => r.status !== "missing").map((r) => r.name),
    usage: letter.llmCalls.map((c) => ({
      step: c.step,
      inputTokens: c.inputTokens,
      outputTokens: c.outputTokens,
      attempts: c.attempts,
      success: c.success,
      estimated: c.estimated,
      model: c.model,
    })),
  };
}

export async function listProfileLetters(profileId: string) {
  const letters = await db.letter.findMany({ where: { profileId }, orderBy: { createdAt: "desc" } });
  return letters.map((letter) => {
    const analysis = letter.analysis as OfferAnalysis | null;
    return {
      id: letter.id,
      title: analysis?.jobTitle ?? "Offre en cours d'analyse",
      company: analysis?.company,
      status: letter.status,
      createdAt: letter.createdAt,
    };
  });
}
