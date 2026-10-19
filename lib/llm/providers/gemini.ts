import { ApiError, GoogleGenAI, type Content } from "@google/genai";
import { LLMRateLimitError, LLMResponseError } from "@/lib/llm/errors";
import { sanitizeForGemini } from "@/lib/llm/json-schema";
import type { LLMProvider } from "@/lib/llm/types";

type ModelsClient = Pick<GoogleGenAI, "models">;

function createClient(apiKey: string) {
  return new GoogleGenAI({
    apiKey,
    // 429 exclu des retries du SDK : avec le niveau gratuit, mieux vaut un message clair tout de suite
    // qu'une attente silencieuse de plusieurs dizaines de secondes.
    httpOptions: { retryOptions: { attempts: 3, httpStatusCodes: [408, 500, 502, 503, 504] } },
  });
}

/** Lit le délai conseillé (RetryInfo.retryDelay, ex. "37s") dans le message d'erreur de l'API. */
export function parseRetryDelaySeconds(message: string): number | undefined {
  const match = /"retryDelay"\s*:\s*"(\d+(?:\.\d+)?)s"/.exec(message);
  return match ? Math.ceil(Number(match[1])) : undefined;
}

export function rateLimitError(error: ApiError): LLMRateLimitError {
  const seconds = parseRetryDelaySeconds(error.message);
  const daily = /per\s*day|PerDay/i.test(error.message);
  const message = daily
    ? "Quota quotidien Gemini épuisé (niveau gratuit). Réessaie demain ou utilise une clé avec facturation."
    : `Limite de requêtes Gemini atteinte (niveau gratuit probable). Réessaie dans ${seconds ?? "quelques"} s.`;
  return new LLMRateLimitError("gemini", daily ? undefined : seconds, message, { cause: error });
}

/** Sortie structurée native : responseMimeType JSON + responseJsonSchema (mots-clés filtrés pour Gemini). */
export function createGeminiProvider(options: { apiKey: string; model: string; client?: ModelsClient }): LLMProvider {
  const client = options.client ?? createClient(options.apiKey);

  return {
    name: "gemini",
    model: options.model,
    async complete(request) {
      const contents: Content[] = request.turns.map((turn) => ({
        role: turn.role === "user" ? "user" : "model",
        parts: [{ text: turn.text }],
      }));

      let response;
      try {
        response = await client.models.generateContent({
          model: options.model,
          contents,
          config: {
            systemInstruction: request.system,
            responseMimeType: "application/json",
            responseJsonSchema: sanitizeForGemini(request.jsonSchema),
            maxOutputTokens: request.maxOutputTokens,
          },
        });
      } catch (error) {
        if (error instanceof ApiError && error.status === 429) throw rateLimitError(error);
        throw error;
      }

      const finishReason = response.candidates?.[0]?.finishReason;
      if (finishReason === "MAX_TOKENS") {
        throw new LLMResponseError(`Réponse tronquée : limite de ${request.maxOutputTokens} tokens de sortie atteinte.`);
      }
      const text = response.text;
      if (!text) {
        throw new LLMResponseError(`Réponse vide du modèle${finishReason ? ` (finishReason : ${finishReason})` : ""}.`);
      }

      const usage = response.usageMetadata;
      return {
        text,
        usage: {
          inputTokens: usage?.promptTokenCount ?? 0,
          // Les tokens de réflexion sont facturés comme de la sortie.
          outputTokens: (usage?.candidatesTokenCount ?? 0) + (usage?.thoughtsTokenCount ?? 0),
          cacheReadTokens: usage?.cachedContentTokenCount,
        },
      };
    },
  };
}
