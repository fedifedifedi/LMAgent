import type { ComintyClient, StartedMessage } from "@/lib/cominty/client";
import type { ComintyEvent, ComintyMessage } from "@/lib/cominty/schemas";
import type { StreamItem } from "@/lib/cominty/stream";
import { MOCK_FIXTURES } from "@/lib/llm/fixtures";

/** Ce dont la lettre par agent a besoin : le vrai client ou ce faux client. */
export type AgentClient = Pick<ComintyClient, "agentId" | "startChat" | "sendMessage" | "stream" | "cancel">;

type MockTurn = { messageId: string; content: string; reply: ComintyMessage; events: ComintyEvent[]; cancelled?: boolean };
type MockThread = { id: string; allowedIds: string[]; turns: MockTurn[] };

/** Question native du faux agent sur un vrai manque de l'offre du mock : Docker, exigé, absent du profil de Camille. */
export const MOCK_QUESTION = {
  prompt: "As-tu déjà travaillé avec Docker ? Si oui, où ?",
  options: ["Oui", "Non"],
};

/** Réponse « needs_input » du faux agent : l'analyse et les manques accompagnent la question (comme le vrai agent). */
const mockNeedsInput = () => ({
  status: "needs_input",
  analysis: MOCK_FIXTURES.offer_analysis,
  gaps: [{ requirement: "Docker", importance: "required" }],
});

/** "{{source:N}}" → N-ième id autorisé (comme le provider mock), pour que la réponse vaille pour n'importe quel profil. */
function fillSources(value: unknown, ids: string[]): unknown {
  const text = JSON.stringify(value).replace(/\{\{source:(\d+)\}\}/g, (_, n: string) => ids[Number(n) % Math.max(ids.length, 1)] ?? "");
  return JSON.parse(text);
}

/** Réponse « ready » cohérente, construite à partir des fixtures du mock (offre Ateliers Nova). */
export function mockReadyReply(allowedIds: string[]) {
  const analysis = MOCK_FIXTURES.offer_analysis as { requirements: Array<{ name: string; importance: string }> };
  const match = fillSources(MOCK_FIXTURES.profile_match, allowedIds) as {
    requirements: Array<{ name: string; status: "matched" | "partial" | "missing"; evidence: string; sourceIds: string[] }>;
  };
  const importance = new Map(analysis.requirements.map((r) => [r.name, r.importance]));
  return {
    status: "ready",
    analysis,
    score: 78,
    scoreReasons: [
      "React et TypeScript, exigés, sont prouvés par le stage chez Acme Logiciels.",
      "Les tests de bout en bout demandés ont déjà été mis en place sur un parcours de commande.",
      "Docker, exigé, n'apparaît pas dans le profil.",
    ],
    strengths: match.requirements
      .filter((r) => r.status !== "missing")
      .map((r) => ({ requirement: r.name, status: r.status, evidence: r.evidence, sourceIds: r.sourceIds })),
    gaps: match.requirements
      .filter((r) => r.status === "missing")
      .map((r) => ({ requirement: r.name, importance: importance.get(r.name) ?? "required", note: "Absent du profil : à ne pas revendiquer." })),
    letter: fillSources(MOCK_FIXTURES.letter_draft, allowedIds),
    cvAdjustments: fillSources(
      [
        { section: "Expériences – Acme Logiciels", change: "Placer les tests end-to-end en première puce.", reason: "L'offre demande des tests sur les parcours critiques.", sourceIds: ["{{source:0}}"] },
        { section: "Titre du profil", change: "Ajouter « React · TypeScript » au titre.", reason: "Ce sont les deux compétences exigées.", sourceIds: [] },
      ],
      allowedIds,
    ),
  };
}

function event(n: number, correlation: number, name: string, status: "running" | "success", data?: unknown): ComintyEvent {
  return { id: `mock-e${n}`, correlation_id: correlation, at: new Date().toISOString(), status, name, ...(data ? { data } : {}) } as ComintyEvent;
}

/**
 * Faux agent Cominty, sans réseau ni crédit : pose une question au premier message, rend la lettre ensuite.
 * Les événements imitent ceux d'un vrai flux (mise en route, réflexion, résultat avec coût).
 */
/** readyReply : réponse « ready » personnalisée (ex. scripts/demo pour Léa Dubois), sinon celle des fixtures du mock. */
export function createMockComintyClient(options: { delayMs?: number; askFirst?: boolean; readyReply?: (allowedIds: string[]) => unknown } = {}): AgentClient {
  const delayMs = options.delayMs ?? 350;
  const askFirst = options.askFirst ?? true;
  const threads = new Map<string, MockThread>();
  const byMessage = new Map<string, { thread: MockThread; turn: MockTurn }>();

  function respond(thread: MockThread, content: string): StartedMessage {
    const messageId = `mock-msg-${crypto.randomUUID()}`;
    const isFirst = thread.turns.length === 0;
    const ask = askFirst && isFirst;
    const text = JSON.stringify(ask ? mockNeedsInput() : (options.readyReply ?? mockReadyReply)(thread.allowedIds));
    const reply: ComintyMessage = {
      id: messageId,
      thread_id: thread.id,
      role: "assistant",
      content: text,
      status: "success",
      questions: ask ? [MOCK_QUESTION] : [],
      files: [],
    };
    const cost = { failed: false, input_tokens: Math.ceil(content.length / 4), cached_tokens: 0, output_tokens: Math.ceil(text.length / 4), input_cost: 0, output_cost: 0, total: 0 };
    const events = [
      event(1, 1, "waiting_for_start", "running"),
      event(2, 1, "waiting_for_start", "success"),
      event(3, 2, "setting_up_sandbox", "running"),
      event(4, 2, "setting_up_sandbox", "success"),
      event(5, 3, "llm", "running", { description: "Reasoning", model: "mock" }),
      event(6, 3, "llm", "success", { description: "Reasoning", model: "mock" }),
      event(7, 4, "result", "success", { reply: text, files: [], questions: reply.questions, cost }),
    ];
    const turn = { messageId, content, reply, events };
    thread.turns.push(turn);
    byMessage.set(messageId, { thread, turn });
    return { threadId: thread.id, messageId };
  }

  const sleep = (signal?: AbortSignal) =>
    new Promise<void>((resolve, reject) => {
      if (delayMs <= 0) return resolve();
      const timer = setTimeout(resolve, delayMs);
      signal?.addEventListener("abort", () => {
        clearTimeout(timer);
        reject(new DOMException("Aborted", "AbortError"));
      });
    });

  return {
    agentId: "mock-agent",
    async startChat(content) {
      const ids = /Ids de sources autorisés : (.+)/.exec(content)?.[1]?.split(",").map((id) => id.trim()).filter(Boolean) ?? [];
      const thread: MockThread = { id: `mock-thread-${crypto.randomUUID()}`, allowedIds: ids, turns: [] };
      threads.set(thread.id, thread);
      return respond(thread, content);
    },
    async sendMessage(threadId, content) {
      const thread = threads.get(threadId);
      if (!thread) throw new Error(`Conversation mock inconnue : ${threadId}`);
      return respond(thread, content);
    },
    async *stream(messageId, streamOptions = {}): AsyncGenerator<StreamItem> {
      const entry = byMessage.get(messageId);
      if (!entry) throw new Error(`Message mock inconnu : ${messageId}`);
      const { turn } = entry;
      const start = streamOptions.lastEventId ? turn.events.findIndex((e) => e.id === streamOptions.lastEventId) + 1 : 0;
      for (const e of turn.events.slice(start)) {
        await sleep(streamOptions.signal);
        if (turn.cancelled) break;
        yield { type: "event", event: e };
      }
      yield { type: "message", message: turn.cancelled ? { ...turn.reply, status: "cancelled", content: "" } : turn.reply };
    },
    async cancel(messageId) {
      const entry = byMessage.get(messageId);
      if (!entry) throw new Error(`Message mock inconnu : ${messageId}`);
      entry.turn.cancelled = true;
      return { ...entry.turn.reply, status: "cancelled", content: "" };
    },
  };
}

const globalMock = globalThis as typeof globalThis & { __lmagentMockCominty?: AgentClient };

/** Instance partagée (actions serveur et route du flux), conservée entre les rechargements de next dev. */
export function getMockComintyClient(): AgentClient {
  globalMock.__lmagentMockCominty ??= createMockComintyClient();
  return globalMock.__lmagentMockCominty;
}
