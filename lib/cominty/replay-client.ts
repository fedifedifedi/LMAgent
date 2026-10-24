import type { AgentClient } from "@/lib/cominty/mock-client";
import type { ComintyEvent, ComintyMessage } from "@/lib/cominty/schemas";
import type { StreamItem } from "@/lib/cominty/stream";
import recorded from "@/lib/demo/recorded-run.json";

/** Préfixe des messages rejoués : la route du flux choisit ce client d'après l'id du message, sans appel réseau. */
export const REPLAY_PREFIX = "replay-";
export const REPLAY_AGENT_ID = "replay";
/** Attente maximale entre deux étapes : les 2 min 20 s de réflexion réelle sont ramenées à quelques secondes. */
const MAX_GAP_MS = 1500;

export const RECORDED_RUN = recorded;

/**
 * Rejoue un vrai run de l'agent Cominty enregistré (lib/demo/recorded-run.json) : mêmes étapes, même réponse, même
 * affichage en direct, aucun appel ni crédit. Sert au bouton de démo sans code d'accès.
 */
export function createReplayClient(options: { compress?: boolean } = {}): AgentClient {
  const compress = options.compress ?? true;
  const events = [...recorded.events].sort((a, b) => a.offsetMs - b.offsetMs);
  const reply = JSON.stringify(recorded.reply);

  const message = (messageId: string, status: ComintyMessage["status"] = "success"): ComintyMessage => ({
    id: messageId,
    thread_id: `${REPLAY_PREFIX}thread`,
    role: "assistant",
    content: status === "success" ? reply : "",
    status,
    questions: [],
    files: [],
  });

  return {
    agentId: REPLAY_AGENT_ID,
    async startChat() {
      return { threadId: `${REPLAY_PREFIX}thread-${crypto.randomUUID()}`, messageId: `${REPLAY_PREFIX}${crypto.randomUUID()}` };
    },
    async sendMessage() {
      throw new Error("La démo enregistrée ne peut pas être poursuivie : saisis un code d'accès pour un vrai run.");
    },
    async *stream(messageId, streamOptions = {}): AsyncGenerator<StreamItem> {
      const start = streamOptions.lastEventId ? Number(streamOptions.lastEventId.replace(`${REPLAY_PREFIX}e`, "")) + 1 : 0;
      let previous = start > 0 ? events[start - 1].offsetMs : 0;
      for (let index = start; index < events.length; index++) {
        const e = events[index];
        const wait = compress ? Math.min(e.offsetMs - previous, MAX_GAP_MS) : 0;
        previous = e.offsetMs;
        if (wait > 0) {
          await new Promise<void>((resolve, reject) => {
            const timer = setTimeout(resolve, wait);
            streamOptions.signal?.addEventListener("abort", () => {
              clearTimeout(timer);
              reject(new DOMException("Aborted", "AbortError"));
            });
          });
        }
        const at = new Date(new Date(recorded.recordedAt).getTime() + e.offsetMs).toISOString();
        const base = { id: `${REPLAY_PREFIX}e${index}`, correlation_id: e.correlationId, at, status: e.status as "running" | "success" };
        const event = (
          e.name === "llm"
            ? { ...base, name: "llm", data: { description: "Reasoning" } }
            : e.name === "result"
              ? { ...base, name: "result", data: { reply, files: [], questions: [], cost: { failed: false, ...recorded.cost, input_cost: 0, output_cost: 0 } } }
              : { ...base, name: e.name }
        ) as ComintyEvent;
        yield { type: "event", event };
      }
      yield { type: "message", message: message(messageId) };
    },
    async cancel(messageId) {
      return message(messageId, "cancelled");
    },
  };
}
