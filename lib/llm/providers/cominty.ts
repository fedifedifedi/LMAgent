import { createComintyClient, type ComintyClient } from "@/lib/cominty/client";
import { readComintyConfig } from "@/lib/cominty/config";
import { ComintyAuthError, ComintyConfigError, ComintyError, ComintyRateLimitError } from "@/lib/cominty/errors";
import { extractJsonText } from "@/lib/cominty/json";
import type { ComintyCost, ComintyEvent } from "@/lib/cominty/schemas";
import { LLMConfigError, LLMRateLimitError, LLMResponseError } from "@/lib/llm/errors";
import type { Attachment, CompletionRequest, LLMProvider } from "@/lib/llm/types";

/** Sous-ensemble du client utilisé ici (remplaçable par un faux client dans les tests). */
export type ComintyTaskClient = Pick<ComintyClient, "agentId" | "startChat" | "sendMessage" | "waitForMessage" | "uploadFile">;

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

      try {
        let started;
        if (native?.threadId) {
          started = await client.sendMessage(native.threadId, request.turns.at(-1)?.text ?? "");
        } else {
          const fileIds = [];
          for (const [index, file] of (request.attachments ?? []).entries()) {
            fileIds.push(await client.uploadFile(file.data, `cv-${index + 1}.${EXTENSIONS[file.mimeType]}`, file.mimeType));
          }
          started = await client.startChat(taskMessage(request, fileIds.length > 0), { fileIds });
        }

        const message = await client.waitForMessage(started.messageId, { onEvent });
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
        throw toLLMError(error);
      }
    },
  };
}

/** Client réel, configuré par COMINTY_* ; une variable manquante devient une LLMConfigError comme pour les autres providers. */
export function defaultClient(env: Record<string, string | undefined>): ComintyTaskClient {
  try {
    return createComintyClient(readComintyConfig(env));
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
