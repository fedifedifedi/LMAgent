import { CANDIDATE_ANSWERS_LABEL, CANDIDATE_ANSWERS_SOURCE, type AgentInsights } from "@/lib/agent/agent-reply";
import type { LetterIssue } from "@/lib/agent/letter-checks";
import { REPLAY_PREFIX } from "@/lib/cominty/replay-client";
import { companyLocation } from "@/lib/letters/text";
import type { ComintyQuestion } from "@/lib/cominty/schemas";
import type { LetterReview } from "@/lib/agent/review";
import { EVENT_ORDER, reviewStep, timelineOf, type TimelineStep } from "@/lib/letters/agent-run";
import type { Critique, OfferAnalysis, ProfileMatch } from "@/lib/agent/schemas";
import type { StoredLetter } from "@/lib/letters/stored";
import { DEFAULT_TEMPLATE, isLetterTemplate, type LetterTemplate } from "@/lib/letters/templates";
import { buildSourceCatalog } from "@/lib/agent/sources";
import { db } from "@/lib/db";
import type { LlmStep } from "@/lib/generated/prisma/enums";
import { ProfileSchema } from "@/lib/schemas/profile";

export type LetterHeader = {
  senderName: string;
  senderLines: string[];
  recipientLines: string[];
  placeAndDate: string;
};

export type UsageRow = {
  step: LlmStep;
  inputTokens: number;
  outputTokens: number;
  attempts: number;
  success: boolean;
  estimated: boolean;
  model: string;
  costUsd: number | null;
};

/** État de l'agent Cominty sur la lettre : exécution à suivre, questions en attente, étapes déjà reçues. */
export type AgentState = {
  /** Exécution en cours (à suivre en direct), sinon null. */
  activeRunId: string | null;
  /** Dernière exécution, pour réafficher son état final. */
  lastRunId: string | null;
  questions: ComintyQuestion[] | null;
  timeline: TimelineStep[];
  /** Démo sans code d'accès : rejeu d'un vrai run enregistré, sans aucun appel. */
  replay: boolean;
};

/** Tout ce que la page de la lettre affiche, sérialisable pour le navigateur. */
export type LetterView = {
  id: string;
  profileId: string;
  profileName: string;
  status: "DRAFT" | "NEEDS_INPUT" | "GENERATED" | "FAILED" | "FINAL";
  error: string | null;
  offerText: string;
  offerUrl: string | null;
  analysis: OfferAnalysis | null;
  match: ProfileMatch | null;
  critique: Critique | null;
  /** Première version écrite (avant la critique). */
  hasDraft: boolean;
  letter: StoredLetter | null;
  /** Une version générée existe et la lettre a été retouchée depuis : « Revenir à la version générée » possible. */
  canRevert: boolean;
  template: LetterTemplate;
  checks: LetterIssue[];
  header: LetterHeader;
  sources: Record<string, string>;
  /** Compétences de l'offre trouvées dans le profil : surlignées à la demande. */
  highlightTerms: string[];
  usage: UsageRow[];
  agent: AgentState;
  /** Score, raisons et ajustements du CV proposés par l'agent (lettres générées par Cominty). */
  insights: AgentInsights | null;
  /** Relecture des preuves (étape visible, phrases avant / après). */
  review: LetterReview | null;
};

/** Étape « Relecture » placée après le premier tour, juste avant la correction (même ordre qu'en direct). */
function withReviewStep(steps: TimelineStep[], review: LetterReview | null, correctionRunId: string | undefined): TimelineStep[] {
  if (!review) return steps;
  const step = reviewStep(review);
  const index = correctionRunId ? steps.findIndex((s) => s.key.startsWith(`${correctionRunId}:`)) : -1;
  return index < 0 ? [...steps, step] : [...steps.slice(0, index), step, ...steps.slice(index)];
}

function formatDate(date: Date, language: "fr" | "en") {
  return date.toLocaleDateString(language === "fr" ? "fr-FR" : "en-GB", { day: "numeric", month: "long", year: "numeric" });
}

export async function getLetterView(id: string): Promise<LetterView | null> {
  const letter = await db.letter.findUnique({
    where: { id },
    include: {
      profile: true,
      llmCalls: { orderBy: { createdAt: "asc" } },
      agentRuns: { orderBy: { createdAt: "asc" }, include: { events: { orderBy: EVENT_ORDER } } },
    },
  });
  if (!letter) return null;
  const lastRun = letter.agentRuns.at(-1);

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
    analysis,
    match,
    critique: (letter.critique as Critique | null) ?? null,
    hasDraft: Boolean(letter.draft),
    letter: (letter.content as StoredLetter | null) ?? null,
    canRevert: Boolean(letter.generated),
    template: isLetterTemplate(letter.template) ? letter.template : DEFAULT_TEMPLATE,
    checks: (letter.checks as LetterIssue[] | null) ?? [],
    header: {
      senderName: name,
      senderLines: [city, profile.contact.email, profile.contact.phone].filter((line): line is string => Boolean(line)),
      recipientLines: [analysis?.contact ? `À l'attention de ${analysis.contact.name}` : undefined, analysis?.company, analysis?.location ? companyLocation(analysis.location) : undefined]
        .filter((line): line is string => Boolean(line))
        .map((line) => (language === "en" && line.startsWith("À l'attention de ") ? line.replace("À l'attention de ", "For the attention of ") : line)),
      placeAndDate: language === "fr" ? `${city ? `${city}, le ` : "Le "}${date}` : city ? `${city}, ${date}` : date,
    },
    sources: { ...Object.fromEntries(buildSourceCatalog(profile).map((entry) => [entry.id, entry.label])), [CANDIDATE_ANSWERS_SOURCE]: CANDIDATE_ANSWERS_LABEL },
    highlightTerms: (match?.requirements ?? []).filter((r) => r.status !== "missing").map((r) => r.name),
    usage: letter.llmCalls.map((c) => ({
      step: c.step,
      inputTokens: c.inputTokens,
      outputTokens: c.outputTokens,
      attempts: c.attempts,
      success: c.success,
      estimated: c.estimated,
      model: c.model,
      costUsd: c.costUsd,
    })),
    agent: {
      activeRunId: letter.agentRuns.find((run) => run.status === "RUNNING")?.id ?? null,
      lastRunId: lastRun?.id ?? null,
      questions: letter.status === "NEEDS_INPUT" && lastRun?.questions ? (lastRun.questions as ComintyQuestion[]) : null,
      timeline: withReviewStep(
        timelineOf(letter.agentRuns.flatMap((run) => run.events)),
        (letter.review as LetterReview | null) ?? null,
        letter.agentRuns.find((run) => run.kind === "CORRECTION")?.id,
      ),
      replay: letter.agentRuns.some((run) => run.messageId.startsWith(REPLAY_PREFIX)),
    },
    insights: (letter.insights as AgentInsights | null) ?? null,
    review: (letter.review as LetterReview | null) ?? null,
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
