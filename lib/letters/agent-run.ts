import { evidenceContext } from "@/lib/agent/evidence-checks";
import { completeReview, REVIEW_STEP_KEY, reviewLabel, startReview, type LetterReview } from "@/lib/agent/review";
import { checkLetter, EVIDENCE_ISSUE_KINDS } from "@/lib/agent/letter-checks";
import { eventLabel } from "@/lib/agent/agent-labels";
import {
  agentAnswersMessage,
  agentCorrectionMessage,
  agentEvidenceCorrectionMessage,
  agentLetterMessage,
  agentSourceIds,
  parseAgentReply,
  toLetterFields,
  type CandidateAnswer,
} from "@/lib/agent/agent-reply";
import { ComintyError, ComintyStreamError } from "@/lib/cominty/errors";
import { REPLAY_AGENT_ID } from "@/lib/cominty/replay-client";
import type { AgentClient } from "@/lib/cominty/mock-client";
import type { ComintyEvent, ComintyMessage, ComintyQuestion } from "@/lib/cominty/schemas";
import { db } from "@/lib/db";
import { Prisma } from "@/lib/generated/prisma/client";
import type { AgentRun } from "@/lib/generated/prisma/client";
import { ProfileSchema } from "@/lib/schemas/profile";

/** Une étape affichée : les phases running / success d'un même événement Cominty (même correlation_id). */
export type TimelineStep = { key: string; label: string; status: "running" | "success" | "error"; at: string };

/** Messages envoyés au navigateur par la route du flux (SSE). */
export type AgentStreamEvent =
  | { type: "step"; step: TimelineStep }
  | { type: "run"; runId: string }
  | { type: "questions"; questions: ComintyQuestion[] }
  | { type: "done" }
  | { type: "failed"; error: string }
  | { type: "interrupted" };

export class AgentRunError extends Error {}

const json = (value: unknown) => value as Prisma.InputJsonValue;

/**
 * Les ids d'événements Cominty ne sont PAS uniques : ce sont des positions dans le flux (« 0-0 » pour les deux phases
 * de waiting_for_start, un même id pour plusieurs événements), utiles seulement pour la reprise (last-event-id).
 * Un événement est identifié par id + étape (correlation_id) + nom + phase.
 */
export const eventKey = (event: Pick<ComintyEvent, "id" | "correlation_id" | "name" | "status">) => `${event.id}|${event.correlation_id}|${event.name}|${event.status}`;

/** Ordre d'affichage : l'étape (correlation_id) ; les horodatages de Cominty ne sont pas monotones. */
export const EVENT_ORDER = [{ correlationId: "asc" as const }, { at: "asc" as const }, { id: "asc" as const }];

export const CANCELLED_MESSAGE = "Génération annulée.";
export const BUDGET_MESSAGE = "Crédits Cominty épuisés : recharge ton compte sur platform.cominty.ai, puis clique sur Reprendre.";
const CORRECTION_FAILED = "L'agent a répondu dans un format inattendu et la demande de correction n'a pas pu être envoyée. Clique sur Reprendre.";
const FOLLOW_FAILED = "Réponse inattendue de Cominty pendant la génération. Clique sur Reprendre.";
const INVALID_AFTER_CORRECTION =
  "L'agent n'a pas produit de lettre au bon format, même après une correction. Clique sur Reprendre pour relancer.";

function stepOf(event: { runId: string; correlationId: number; label: string; status: string; at: Date | string }): TimelineStep {
  const status = event.status === "success" || event.status === "error" ? event.status : "running";
  return { key: `${event.runId}:${event.correlationId}`, label: event.label, status, at: new Date(event.at).toISOString() };
}

/** Étape « Relecture » à partir de la relecture enregistrée sur la lettre. */
export function reviewStep(review: LetterReview): TimelineStep {
  return { key: REVIEW_STEP_KEY, label: reviewLabel(review), status: review.status === "correcting" ? "running" : "success", at: review.at };
}

async function emitReview(letterId: string, emit: (event: AgentStreamEvent) => void) {
  const letter = await db.letter.findUnique({ where: { id: letterId }, select: { review: true } });
  if (letter?.review) emit({ type: "step", step: reviewStep(letter.review as LetterReview) });
}

/** Étapes de toutes les exécutions d'une lettre, dans l'ordre, une ligne par étape (dernier statut connu). */
export function timelineOf(events: Array<{ runId: string; correlationId: number; label: string; status: string; at: Date }>): TimelineStep[] {
  const steps = new Map<string, TimelineStep>();
  for (const event of events) {
    const step = stepOf(event);
    const previous = steps.get(step.key);
    steps.set(step.key, previous ? { ...step, label: previous.label, at: previous.at } : step);
  }
  return [...steps.values()];
}

/** Démarre l'agent sur la lettre (ou renvoie l'exécution déjà en cours : double clic, second onglet). */
export async function startAgentRun(letterId: string, client: AgentClient): Promise<string> {
  const letter = await db.letter.findUnique({ where: { id: letterId }, include: { profile: true, agentRuns: { where: { status: "RUNNING" } } } });
  if (!letter) throw new AgentRunError("Lettre introuvable.");
  if (letter.agentRuns[0]) return letter.agentRuns[0].id;
  if (letter.content) throw new AgentRunError("La lettre est déjà générée.");

  const profile = ProfileSchema.parse(letter.profile.data);
  const started = await client.startChat(agentLetterMessage(profile, letter.offerText));
  const run = await db.agentRun.create({ data: { letterId, threadId: started.threadId, messageId: started.messageId, kind: "START" } });
  await db.letter.update({ where: { id: letterId }, data: { status: "DRAFT", error: null } });
  return run.id;
}

/** Envoie les réponses du candidat dans la conversation de l'agent ; renvoie l'exécution qui les traite. */
/** client : fixe, ou choisi d'après le message de l'agent qui a posé la question (rejeu, faux agent, vrai Cominty). */
type ClientFor = AgentClient | ((messageId: string) => AgentClient | Promise<AgentClient>);
const resolveClient = async (client: ClientFor, messageId: string) => (typeof client === "function" ? client(messageId) : client);

export async function answerAgentRun(letterId: string, answers: CandidateAnswer[], clientFor: ClientFor): Promise<string> {
  const last = await db.agentRun.findFirst({ where: { letterId }, orderBy: { createdAt: "desc" } });
  if (!last || last.status !== "SUCCESS" || !last.questions) throw new AgentRunError("L'agent n'attend pas de réponse pour cette lettre.");
  const cleaned = answers.map((a) => ({ prompt: a.prompt.trim(), answer: a.answer.trim() })).filter((a) => a.answer);
  if (cleaned.length === 0) throw new AgentRunError("Choisis ou écris au moins une réponse.");

  const client = await resolveClient(clientFor, last.messageId);
  const started = await client.sendMessage(last.threadId, agentAnswersMessage(cleaned));
  const run = await db.agentRun.create({ data: { letterId, threadId: started.threadId, messageId: started.messageId, kind: "ANSWER" } });
  await db.letter.update({ where: { id: letterId }, data: { status: "DRAFT", error: null } });
  return run.id;
}

/** Arrête l'exécution en cours (côté Cominty aussi) ; la lettre devient reprenable. */
export async function cancelAgentRun(letterId: string, clientFor: ClientFor): Promise<void> {
  const run = await db.agentRun.findFirst({ where: { letterId, status: "RUNNING" } });
  if (!run) return;
  const client = await resolveClient(clientFor, run.messageId);
  await client.cancel(run.messageId).catch((error) => console.error("Annulation Cominty :", error));
  await db.agentRun.updateMany({ where: { id: run.id, status: "RUNNING" }, data: { status: "CANCELLED", finishedAt: new Date() } });
  await db.letter.update({ where: { id: letterId }, data: { status: "FAILED", error: CANCELLED_MESSAGE } });
}

type Outcome = { type: "next"; runId: string } | AgentStreamEvent;

/** Coût d'un tour de l'agent : une ligne LlmCall dès l'événement result (affichée dans « Détails de la génération »). */
async function recordCost(run: AgentRun, event: Extract<ComintyEvent, { name: "result" }>, client: AgentClient) {
  const { cost } = event.data;
  // Rejeu de la démo : tokens du run d'origine affichés, mais aucun coût (rien n'est appelé ni facturé).
  const replay = client.agentId === REPLAY_AGENT_ID;
  await db.llmCall.create({
    data: {
      letterId: run.letterId,
      step: "AGENT_LETTER",
      provider: replay ? "replay" : client.agentId.startsWith("mock") ? "mock" : "cominty",
      model: replay ? "rejeu d'un vrai run Cominty" : `agent:${client.agentId}`,
      inputTokens: cost.input_tokens,
      outputTokens: cost.output_tokens,
      cacheReadTokens: cost.cached_tokens,
      costUsd: replay ? null : cost.total,
      attempts: 1,
      durationMs: Math.max(0, Date.now() - run.createdAt.getTime()),
      estimated: client.agentId.startsWith("mock"),
      success: !cost.failed,
    },
  });
}

/** Message final d'un tour : questions, lettre prête, correction unique, ou échec. Une seule fois par exécution. */
async function finishRun(run: AgentRun, message: ComintyMessage, client: AgentClient): Promise<Outcome> {
  const claim = (data: Prisma.AgentRunUpdateManyMutationInput) =>
    db.agentRun.updateMany({ where: { id: run.id, status: "RUNNING" }, data: { finishedAt: new Date(), ...data } }).then((r) => r.count === 1);
  const fail = async (status: "FAILED" | "CANCELLED", error: string, runError?: string): Promise<Outcome> => {
    if (!(await claim({ status, error: runError ?? error }))) return { type: "run", runId: run.id };
    await db.letter.update({ where: { id: run.letterId }, data: { status: "FAILED", error } });
    return { type: "failed", error };
  };

  if (message.status === "cancelled") return fail("CANCELLED", CANCELLED_MESSAGE);
  if (message.status !== "success") {
    const code = message.error_code;
    return fail("FAILED", code === "budget_exhausted" ? BUDGET_MESSAGE : `L'agent Cominty n'a pas pu terminer (${code ?? "erreur inconnue"}). Clique sur Reprendre.`);
  }

  if (message.questions?.length) {
    if (!(await claim({ status: "SUCCESS", questions: json(message.questions) }))) return { type: "run", runId: run.id };
    await db.letter.update({ where: { id: run.letterId }, data: { status: "NEEDS_INPUT", error: null } });
    return { type: "questions", questions: message.questions };
  }

  const letter = await db.letter.findUniqueOrThrow({ where: { id: run.letterId }, include: { profile: true } });
  const ids = agentSourceIds(ProfileSchema.parse(letter.profile.data));
  const parsed = parseAgentReply(message.content, ids);
  const issues = !parsed.ok ? parsed.issues : parsed.reply.status === "needs_input" ? 'status "needs_input" requires native Cominty questions; ask them, or answer with status "ready".' : undefined;

  if (parsed.ok && parsed.reply.status === "ready") {
    if (!(await claim({ status: "SUCCESS" }))) return { type: "run", runId: run.id };
    const fields = toLetterFields(parsed.reply);
    const evidence = evidenceContext(ProfileSchema.parse(letter.profile.data), letter.offerText);
    const checks = checkLetter(fields.letter, { analysis: fields.analysis, match: fields.match, evidence });
    const evidenceIssues = checks.filter((check) => EVIDENCE_ISSUE_KINDS.has(check.kind));
    // Relecture critique : un problème de preuve (terme de l'offre, statut transféré, verbe renforcé) déclenche la
    // correction unique de la conversation. La lettre est enregistrée tout de suite (visible si la correction échoue).
    const corrected = await db.agentRun.count({ where: { threadId: run.threadId, kind: "CORRECTION" } });
    const correct = evidenceIssues.length > 0 && corrected === 0 && client.agentId !== REPLAY_AGENT_ID;
    // Relecture visible : après la correction, chaque phrase d'origine est rapprochée de sa version corrigée.
    const pending = letter.review as LetterReview | null;
    const review = run.kind === "CORRECTION" && pending?.status === "correcting" ? completeReview(pending, fields.letter, checks) : startReview(checks, correct ? "correcting" : "reported");
    await db.letter.update({
      where: { id: run.letterId },
      data: {
        language: fields.analysis.language,
        analysis: json(fields.analysis),
        match: json(fields.match),
        content: json(fields.letter),
        generated: Prisma.DbNull,
        insights: json(fields.insights),
        checks: json(checks),
        review: json(review),
        status: correct ? "DRAFT" : "GENERATED",
        error: null,
      },
    });
    if (!correct) return { type: "done" };
    try {
      const started = await client.sendMessage(run.threadId, agentEvidenceCorrectionMessage(evidenceIssues.map((issue) => issue.message)));
      const next = await db.agentRun.create({ data: { letterId: run.letterId, threadId: started.threadId, messageId: started.messageId, kind: "CORRECTION" } });
      return { type: "next", runId: next.id };
    } catch (error) {
      // Correction impossible (plafond, réseau) : la lettre reste, avec ses points à vérifier.
      console.error("Correction des preuves :", error);
      await db.letter.update({ where: { id: run.letterId }, data: { status: "GENERATED", review: json({ ...review, status: "reported" }) } });
      return { type: "done" };
    }
  }

  // JSON invalide : une seule correction par conversation (une reprise après échec repart d'une nouvelle conversation).
  // Le début de la réponse est gardé avec les erreurs (AgentRun.error), pour comprendre un format inattendu.
  const diagnosis = `${issues ?? "Invalid answer"}\n\nRéponse reçue (début) :\n${message.content.slice(0, 3000)}`;
  const corrections = await db.agentRun.count({ where: { threadId: run.threadId, kind: "CORRECTION" } });
  if (corrections > 0) {
    const existing = await db.letter.findUnique({ where: { id: run.letterId }, select: { content: true } });
    if (existing?.content && (await claim({ status: "FAILED", error: diagnosis }))) {
      // La correction des preuves a échoué (format) : la première lettre reste, avec ses points à vérifier.
      const pending = (await db.letter.findUniqueOrThrow({ where: { id: run.letterId }, select: { review: true } })).review as LetterReview | null;
      await db.letter.update({ where: { id: run.letterId }, data: { status: "GENERATED", ...(pending ? { review: json({ ...pending, status: "reported" }) } : {}) } });
      return { type: "done" };
    }
    return fail("FAILED", INVALID_AFTER_CORRECTION, diagnosis);
  }
  if (!(await claim({ status: "SUCCESS", error: diagnosis }))) return { type: "run", runId: run.id };
  let started;
  try {
    started = await client.sendMessage(run.threadId, agentCorrectionMessage(issues ?? "Invalid answer"));
  } catch (error) {
    console.error("Correction Cominty :", error);
    const reason = error instanceof ComintyError ? ` (${error.message})` : "";
    await db.letter.update({ where: { id: run.letterId }, data: { status: "FAILED", error: `${CORRECTION_FAILED}${reason}` } });
    return { type: "failed", error: `${CORRECTION_FAILED}${reason}` };
  }
  const next = await db.agentRun.create({ data: { letterId: run.letterId, threadId: started.threadId, messageId: started.messageId, kind: "CORRECTION" } });
  return { type: "next", runId: next.id };
}

/**
 * Erreur inattendue pendant le suivi (réponse illisible de Cominty, base...) : la lettre passe en échec reprenable,
 * sinon la page relancerait l'agent toute seule au prochain affichage (et dépenserait des crédits).
 * Une exécution encore RUNNING est conservée : « Reprendre » la suit au lieu d'en relancer une.
 */
export async function markFollowFailure(letterId: string, error: unknown): Promise<string> {
  console.error("Suivi de l'agent :", error);
  const message = error instanceof ComintyError || error instanceof AgentRunError ? error.message : FOLLOW_FAILED;
  await db.letter.updateMany({ where: { id: letterId, status: { in: ["DRAFT", "NEEDS_INPUT"] } }, data: { status: "FAILED", error: message } });
  return message;
}

/** État final d'une exécution déjà terminée, lu en base (rechargement de la page, second onglet). */
async function settledOutcome(run: AgentRun): Promise<Outcome> {
  const later = await db.agentRun.findFirst({ where: { letterId: run.letterId, createdAt: { gt: run.createdAt } }, orderBy: { createdAt: "asc" } });
  if (later) return { type: "next", runId: later.id };
  const letter = await db.letter.findUniqueOrThrow({ where: { id: run.letterId }, select: { status: true, error: true } });
  if (letter.status === "NEEDS_INPUT" && run.questions) return { type: "questions", questions: run.questions as ComintyQuestion[] };
  if (letter.status === "GENERATED" || letter.status === "FINAL") return { type: "done" };
  return { type: "failed", error: letter.error ?? "La génération s'est arrêtée." };
}

/**
 * Suit une exécution : rejoue les étapes enregistrées, reprend le flux Cominty après le dernier événement connu,
 * enregistre chaque étape, puis traite le message final. Enchaîne sur la correction automatique si besoin.
 * Une coupure laisse l'exécution RUNNING (reprise au prochain affichage) ; l'agent continue côté Cominty.
 */
export async function followAgentRun(runId: string, client: AgentClient, emit: (event: AgentStreamEvent) => void, signal?: AbortSignal): Promise<void> {
  let currentId: string | undefined = runId;
  while (currentId) {
    const run: (AgentRun & { events: Array<{ eventId: string; runId: string; correlationId: number; label: string; status: string; at: Date }> }) | null =
      await db.agentRun.findUnique({ where: { id: currentId }, include: { events: { orderBy: EVENT_ORDER } } });
    if (!run) throw new AgentRunError("Exécution introuvable.");
    for (const event of run.events) emit({ type: "step", step: stepOf(event) });

    let outcome: Outcome;
    if (run.status !== "RUNNING") {
      // Rechargement : l'étape « Relecture » est rejouée au même endroit qu'en direct (après les étapes de ce tour).
      await emitReview(run.letterId, emit);
      outcome = await settledOutcome(run);
    } else {
      outcome = { type: "interrupted" };
      const known = new Set(run.events.map((e) => e.eventId));
      try {
        for await (const item of client.stream(run.messageId, { lastEventId: run.lastEventId ?? undefined, signal })) {
          if (item.type === "message") {
            outcome = await finishRun(run, item.message, client);
            await emitReview(run.letterId, emit);
            break;
          }
          const { event } = item;
          const key = eventKey(event);
          if (known.has(key)) continue;
          known.add(key);
          const saved = await db.agentEvent.create({
            data: { runId: run.id, eventId: key, correlationId: event.correlation_id, name: event.name, status: event.status, label: eventLabel(event), at: new Date(event.at) },
          });
          await db.agentRun.update({ where: { id: run.id }, data: { lastEventId: event.id } });
          if (event.name === "result") await recordCost(run, event, client);
          emit({ type: "step", step: stepOf(saved) });
        }
      } catch (error) {
        if (signal?.aborted || (error instanceof Error && error.name === "AbortError")) return;
        if (!(error instanceof ComintyStreamError)) throw error;
      }
    }

    if (outcome.type === "next") {
      emit({ type: "run", runId: outcome.runId });
      currentId = outcome.runId;
      continue;
    }
    // Une autre connexion a terminé l'exécution entre-temps : on relit l'état final en base.
    if (outcome.type === "run") {
      const settled = await db.agentRun.findUniqueOrThrow({ where: { id: outcome.runId } });
      outcome = await settledOutcome(settled);
      if (outcome.type === "next") {
        emit({ type: "run", runId: outcome.runId });
        currentId = outcome.runId;
        continue;
      }
    }
    emit(outcome);
    return;
  }
}
