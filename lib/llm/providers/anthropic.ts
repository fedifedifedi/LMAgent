import Anthropic from "@anthropic-ai/sdk";
import { LLMRateLimitError, LLMResponseError } from "@/lib/llm/errors";
import { sanitizeForAnthropic } from "@/lib/llm/json-schema";
import type { LLMProvider } from "@/lib/llm/types";

type MessagesClient = Pick<Anthropic, "messages">;

/**
 * Sortie structurée native : output_config.format (JSON Schema). Pas de tool_choice forcé : il renvoie
 * une 400 sur les modèles actuels (Opus 5.5, Sonnet 5.5, Fable 5.1). Le schéma est adapté par
 * sanitizeForAnthropic (pas jsonSchemaOutputFormat du SDK, qui perd les enums) ; Zod revalide ensuite.
 * Pas de temperature : refusée par les modèles actuels.
 */
export function createAnthropicProvider(options: { apiKey: string; model: string; client?: MessagesClient }): LLMProvider {
  const client = options.client ?? new Anthropic({ apiKey: options.apiKey });

  return {
    name: "anthropic",
    model: options.model,
    async complete(request) {
      // Les réponses précédentes sont renvoyées telles quelles (blocs de réflexion compris).
      const messages: Anthropic.MessageParam[] = request.turns.map((turn) =>
        turn.role === "user"
          ? { role: "user", content: turn.text }
          : { role: "assistant", content: (turn.native as Anthropic.ContentBlockParam[] | undefined) ?? turn.text },
      );

      let response: Anthropic.Message;
      try {
        response = await client.messages.create({
          model: options.model,
          max_tokens: request.maxOutputTokens,
          system: request.system,
          messages,
          output_config: {
            format: { type: "json_schema", schema: sanitizeForAnthropic(request.jsonSchema) },
          },
        });
      } catch (error) {
        if (error instanceof Anthropic.RateLimitError) {
          const retryAfter = Number(error.headers?.get("retry-after"));
          const seconds = Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter : undefined;
          throw new LLMRateLimitError(
            "anthropic",
            seconds,
            `Limite de requêtes Anthropic atteinte${seconds ? `, réessaie dans ${seconds} s` : ", réessaie dans quelques instants"}.`,
            { cause: error },
          );
        }
        throw error;
      }

      if (response.stop_reason === "refusal") {
        throw new LLMResponseError("Le modèle a refusé de répondre à cette requête.");
      }
      if (response.stop_reason === "max_tokens") {
        throw new LLMResponseError(`Réponse tronquée : limite de ${request.maxOutputTokens} tokens de sortie atteinte.`);
      }

      const text = response.content
        .filter((block): block is Anthropic.TextBlock => block.type === "text")
        .map((block) => block.text)
        .join("");
      if (!text) throw new LLMResponseError("Réponse vide du modèle.");

      const { input_tokens, output_tokens, cache_creation_input_tokens, cache_read_input_tokens } = response.usage;
      return {
        text,
        native: response.content,
        usage: {
          inputTokens: input_tokens + (cache_creation_input_tokens ?? 0) + (cache_read_input_tokens ?? 0),
          outputTokens: output_tokens,
          cacheReadTokens: cache_read_input_tokens ?? undefined,
        },
      };
    },
  };
}
