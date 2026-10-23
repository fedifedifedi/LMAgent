import { EVIDENCE_RULES } from "@/lib/agent/evidence-rules";
import { createComintyClient, NO_CAPABILITIES, type ComintyClient } from "@/lib/cominty/client";
import { readComintyConfig } from "@/lib/cominty/config";
import { ComintyAuthError, ComintyConfigError, ComintyError, ComintyRateLimitError } from "@/lib/cominty/errors";
import { guardedClient } from "@/lib/cominty/guard";
import { extractJsonText } from "@/lib/cominty/json";
import type { ComintyCost, ComintyEvent } from "@/lib/cominty/schemas";
import { LLMConfigError, LLMRateLimitError, LLMResponseError } from "@/lib/llm/errors";
import type { Attachment, CompletionRequest, LLMProvider } from "@/lib/llm/types";

/** Sous-ensemble du client utilisé ici (remplaçable par un faux client dans les tests). */
export type ComintyTaskClient = Pick<ComintyClient, "agentId" | "startChat" | "sendMessage" | "waitForMessage" | "uploadFile"> & Partial<Pick<ComintyClient, "cancel">>;

/**
 * Réglages d'une tâche JSON. Texte (CV en PDF texte, résumé) : UN tour, aucun outil — l'agent range des informations
 * déjà lues par le serveur. Fichier (image, PDF scanné) : quelques tours pour que l'agent lise le document, sans web.
 */
export const TEXT_TASK = { maxSteps: 1, capabilities: NO_CAPABILITIES } as const;
export const FILE_TASK = {
  maxSteps: 3,
  capabilities: { web: { activation: "never" }, image_generation: { activation: "never" }, video_generation: { activation: "never" }, music_generation: { activation: "never" }, memory: { activation: "never" } },
} as const;

/** Réponse brute conservée entre les tentatives : la relance continue la même conversation. */
type ComintyNative = { threadId: string };

const EXTENSIONS: Record<Attachment["mimeType"], string> = {
  "application/pdf": "pdf",
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
};

/**
 * Message d'une tâche JSON pour l'agent : l'en-tête « LMAgent task » active la section correspondante de ses
 * instructions (une réponse = un objet JSON conforme au schéma, sans question).
 */
export function taskMessage(request: Pick<CompletionRequest, "name" | "system" | "jsonSchema" | "turns">, hasFiles: boolean): string {
  const input = request.turns[0]?.text ?? "";
  return [
    `LMAgent task: ${request.name}`,
    `Task instructions:\n${request.system}`,
    EVIDENCE_RULES,
    `JSON Schema of the answer:\n${JSON.stringify(request.jsonSchema)}`,
    hasFiles ? `Input (the attached file is the source):\n${input}` : `Input:\n${input}`,
  ].join("\n\n");
}

/** JSON de la réponse, même entouré d'un bloc de code ou suivi de notes (cf. lib/cominty/json.ts). */
export const stripCodeFence = extractJsonText;

/**
 * Provider « cominty » : chaque generateObject devient un tour de l'agent managé Cominty. La validation Zod et
 * les relances restent dans generateObject ; une relance est envoyée dans la même conversation (fichiers inclus).
 */
export function createComintyProvider(client: ComintyTaskClient = defaultClient(process.env)): LLMProvider {
  return {
    name: "cominty",
    model: `agent:${client.agentId}`,
    async complete(request) {
      const previous = [...request.turns].reverse().find((turn) => turn.role === "assistant");
      const native = previous?.role === "assistant" ? (previous.native as ComintyNative | undefined) : undefined;

      let cost: ComintyCost | undefined;
      const onEvent = (event: ComintyEvent) => {
        if (event.name === "result") cost = event.data.cost;
      };

      const { signal } = request;
      let started: { threadId: string; messageId: string } | undefined;
      // Délai dépassé : on arrête aussi la réponse chez Cominty (pas de session qui continue toute seule).
      const onAbort = () => {
        if (started && client.cancel) void client.cancel(started.messageId).catch(() => undefined);
      };
      signal?.addEventListener("abort", onAbort, { once: true });
      try {
        const task = request.attachments?.length ? FILE_TASK : TEXT_TASK;
        if (native?.threadId) {
          started = await client.sendMessage(native.threadId, request.turns.at(-1)?.text ?? "", { maxSteps: task.maxSteps, signal });
        } else {
          const fileIds = [];
          for (const [index, file] of (request.attachments ?? []).entries()) {
            fileIds.push(await client.uploadFile(file.data, `cv-${index + 1}.${EXTENSIONS[file.mimeType]}`, file.mimeType, signal));
          }
          started = await client.startChat(taskMessage(request, fileIds.length > 0), { fileIds, ...task, signal });
        }
        if (signal?.aborted) onAbort();

        const message = await client.waitForMessage(started.messageId, { onEvent, signal });
        if (message.status !== "success") {
          const reason = message.error_code ? ` (${message.error_code})` : "";
          throw new LLMResponseError(`L'agent Cominty n'a pas terminé sa réponse : statut ${message.status}${reason}.`);
        }
        if (message.questions?.length) {
          throw new LLMResponseError(`L'agent Cominty pose une question au lieu de répondre : « ${message.questions[0].prompt} »`);
        }
        return {
          text: stripCodeFence(message.content),
          usage: {
            inputTokens: cost?.input_tokens ?? 0,
            outputTokens: cost?.output_tokens ?? 0,
            cacheReadTokens: cost?.cached_tokens,
            costUsd: cost?.total,
          },
          native: { threadId: started.threadId } satisfies ComintyNative,
        };
      } catch (error) {
        if (signal?.aborted) throw new LLMResponseError("Délai dépassé : l'agent Cominty n'a pas répondu à temps.", { cause: error });
        throw toLLMError(error);
      } finally {
        signal?.removeEventListener("abort", onAbort);
      }
    },
  };
}

/** Client réel, configuré par COMINTY_* ; une variable manquante devient une LLMConfigError comme pour les autres providers. */
export function defaultClient(env: Record<string, string | undefined>): ComintyTaskClient {
  try {
    // Protégé comme pour les lettres : plafond COMINTY_BUDGET_USD vérifié, coût enregistré (ComintyCharge).
    // Tâches JSON (import du CV, résumé) : agent d'extraction dédié s'il est configuré (COMINTY_EXTRACT_AGENT_ID).
    const config = readComintyConfig(env);
    return guardedClient(createComintyClient({ ...config, agentId: config.extractAgentId ?? config.agentId }), env);
  } catch (error) {
    throw toLLMError(error);
  }
}

/** Erreurs Cominty → erreurs de la couche LLM (messages déjà en français, sans la clé). */
function toLLMError(error: unknown): unknown {
  if (error instanceof ComintyRateLimitError) return new LLMRateLimitError("cominty", error.retryAfterSeconds, error.message, { cause: error });
  if (error instanceof ComintyAuthError || error instanceof ComintyConfigError) return new LLMConfigError(error.message, { cause: error });
  if (error instanceof ComintyError) return new LLMResponseError(error.message, { cause: error });
  // Réponse de Cominty à une forme inattendue (schéma Zod du client) : message lisible, détail dans la cause.
  if (error instanceof Error && error.name === "ZodError") return new LLMResponseError("Réponse inattendue de Cominty : réessaie dans un instant.", { cause: error });
  return error;
}
