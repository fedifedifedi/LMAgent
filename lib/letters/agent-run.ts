import { checkLetter } from "@/lib/agent/letter-checks";
import { eventLabel } from "@/lib/agent/agent-labels";
import {
  agentAnswersMessage,
  agentCorrectionMessage,
  agentLetterMessage,
  agentSourceIds,
  parseAgentReply,
  toLetterFields,
  type CandidateAnswer,
} from "@/lib/agent/agent-reply";
import { ComintyStreamError } from "@/lib/cominty/errors";
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

export const CANCELLED_MESSAGE = "Génération annulée.";
export const BUDGET_MESSAGE = "Crédits Cominty épuisés : recharge ton compte sur platform.cominty.ai, puis clique sur Reprendre.";
const INVALID_AFTER_CORRECTION =
  "L'agent n'a pas produit de lettre au bon format, même après une correction. Clique sur Reprendre pour relancer.";

function stepOf(event: { runId: string; correlationId: number; label: string; status: string; at: Date | string }): TimelineStep {
  const status = event.status === "success" || event.status === "error" ? event.status : "running";
  return { key: `${event.runId}:${event.correlationId}`, label: event.label, status, at: new Date(event.at).toISOString() };
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
export async function answerAgentRun(letterId: string, answers: CandidateAnswer[], client: AgentClient): Promise<string> {
  const last = await db.agentRun.findFirst({ where: { letterId }, orderBy: { createdAt: "desc" } });
  if (!last || last.status !== "SUCCESS" || !last.questions) throw new AgentRunError("L'agent n'attend pas de réponse pour cette lettre.");
  const cleaned = answers.map((a) => ({ prompt: a.prompt.trim(), answer: a.answer.trim() })).filter((a) => a.answer);
  if (cleaned.length === 0) throw new AgentRunError("Choisis ou écris au moins une réponse.");

  const started = await client.sendMessage(last.threadId, agentAnswersMessage(cleaned));
  const run = await db.agentRun.create({ data: { letterId, threadId: started.threadId, messageId: started.messageId, kind: "ANSWER" } });
  await db.letter.update({ where: { id: letterId }, data: { status: "DRAFT", error: null } });
  return run.id;
}

/** Arrête l'exécution en cours (côté Cominty aussi) ; la lettre devient reprenable. */
export async function cancelAgentRun(letterId: string, client: AgentClient): Promise<void> {
  const run = await db.agentRun.findFirst({ where: { letterId, status: "RUNNING" } });
  if (!run) return;
  await client.cancel(run.messageId).catch((error) => console.error("Annulation Cominty :", error));
  await db.agentRun.updateMany({ where: { id: run.id, status: "RUNNING" }, data: { status: "CANCELLED", finishedAt: new Date() } });
  await db.letter.update({ where: { id: letterId }, data: { status: "FAILED", error: CANCELLED_MESSAGE } });
}

type Outcome = { type: "next"; runId: string } | AgentStreamEvent;

/** Coût d'un tour de l'agent : une ligne LlmCall dès l'événement result (affichée dans « Détails de la génération »). */
async function recordCost(run: AgentRun, event: Extract<ComintyEvent, { name: "result" }>, client: AgentClient) {
  const { cost } = event.data;
  await db.llmCall.create({
    data: {
      letterId: run.letterId,
      step: "AGENT_LETTER",
      provider: client.agentId.startsWith("mock") ? "mock" : "cominty",
      model: `agent:${client.agentId}`,
      inputTokens: cost.input_tokens,
      outputTokens: cost.output_tokens,
      cacheReadTokens: cost.cached_tokens,
      costUsd: cost.total,
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
    const checks = checkLetter(fields.letter, { analysis: fields.analysis, match: fields.match });
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
        status: "GENERATED",
        error: null,
      },
    });
    return { type: "done" };
  }

  // JSON invalide : une seule correction par lettre, dans la même conversation.
  const corrections = await db.agentRun.count({ where: { letterId: run.letterId, kind: "CORRECTION" } });
  if (corrections > 0) return fail("FAILED", INVALID_AFTER_CORRECTION, issues);
  if (!(await claim({ status: "SUCCESS", error: issues }))) return { type: "run", runId: run.id };
  const started = await client.sendMessage(run.threadId, agentCorrectionMessage(issues ?? "Invalid answer"));
  const next = await db.agentRun.create({ data: { letterId: run.letterId, threadId: started.threadId, messageId: started.messageId, kind: "CORRECTION" } });
  return { type: "next", runId: next.id };
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
      await db.agentRun.findUnique({ where: { id: currentId }, include: { events: { orderBy: [{ at: "asc" }, { id: "asc" }] } } });
    if (!run) throw new AgentRunError("Exécution introuvable.");
    for (const event of run.events) emit({ type: "step", step: stepOf(event) });

    let outcome: Outcome;
    if (run.status !== "RUNNING") {
      outcome = await settledOutcome(run);
    } else {
      outcome = { type: "interrupted" };
      const known = new Set(run.events.map((e) => e.eventId));
      try {
        for await (const item of client.stream(run.messageId, { lastEventId: run.lastEventId ?? undefined, signal })) {
          if (item.type === "message") {
            outcome = await finishRun(run, item.message, client);
            break;
          }
          const { event } = item;
          if (known.has(event.id)) continue;
          known.add(event.id);
          const saved = await db.agentEvent.create({
            data: { runId: run.id, eventId: event.id, correlationId: event.correlation_id, name: event.name, status: event.status, label: eventLabel(event), at: new Date(event.at) },
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
