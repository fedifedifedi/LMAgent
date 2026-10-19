import Anthropic from "@anthropic-ai/sdk";
import { ApiError } from "@google/genai";
import { describe, expect, test } from "bun:test";
import { z } from "zod";
import { readLLMConfig } from "@/lib/llm/config";
import { LLMConfigError, LLMRateLimitError, LLMResponseError } from "@/lib/llm/errors";
import { generateObject } from "@/lib/llm/generate";
import { getProvider } from "@/lib/llm";
import { createAnthropicProvider } from "@/lib/llm/providers/anthropic";
import { createGeminiProvider } from "@/lib/llm/providers/gemini";

const output = { name: "level", schema: z.object({ level: z.enum(["B2", "C1"]), since: z.string().regex(/^\d{4}$/) }) };
const base = { system: "Extract the level.", prompt: "Anglais courant depuis 2019", output };

/** Faux client : renvoie les réponses dans l'ordre et enregistre les requêtes. */
function fakeClient<R>(responses: Array<R | Error>) {
  // Requêtes SDK brutes, inspectées librement dans les assertions.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const requests: any[] = [];
  const call = async (request: unknown) => {
    // Copie JSON : le format d'Anthropic (jsonSchemaOutputFormat) porte une fonction parse non clonable.
    requests.push(JSON.parse(JSON.stringify(request)));
    const next = responses[Math.min(requests.length - 1, responses.length - 1)];
    if (next instanceof Error) throw next;
    return next;
  };
  return { requests, call };
}

const anthropicMessage = (text: string, extra: Partial<Anthropic.Message> = {}) =>
  ({
    content: [
      { type: "thinking", thinking: "", signature: "sig" },
      { type: "text", text },
    ],
    stop_reason: "end_turn",
    usage: { input_tokens: 10, output_tokens: 5, cache_creation_input_tokens: 0, cache_read_input_tokens: 20 },
    ...extra,
  }) as unknown as Anthropic.Message;

describe("provider anthropic", () => {
  const create = (responses: Array<Anthropic.Message | Error>) => {
    const fake = fakeClient(responses);
    const client = { messages: { create: fake.call } } as unknown as Pick<Anthropic, "messages">;
    return { provider: createAnthropicProvider({ apiKey: "k", model: "test-model", client }), requests: fake.requests };
  };

  test("output_config.format JSON Schema, pas de tool_choice forcé ni de temperature", async () => {
    const { provider, requests } = create([anthropicMessage('{"level":"C1","since":"2019"}')]);
    const result = await generateObject({ ...base, provider });

    expect(result.data).toEqual({ level: "C1", since: "2019" });
    const request = requests[0];
    expect(request).toMatchObject({ model: "test-model", system: "Extract the level." });
    expect(request.output_config.format.type).toBe("json_schema");
    expect(request.output_config.format.schema.properties.level.enum).toEqual(["B2", "C1"]);
    expect(request.output_config.format.schema.additionalProperties).toBe(false);
    // pattern non géré par l'API : reporté dans description, vérifié par Zod.
    expect(request.output_config.format.schema.properties.since).toEqual({
      type: "string",
      description: '{pattern: "^\\\\d{4}$"}',
    });
    expect(request.tool_choice).toBeUndefined();
    expect(request.tools).toBeUndefined();
    expect(request.temperature).toBeUndefined();
    expect(result.usage).toMatchObject({ provider: "anthropic", model: "test-model", inputTokens: 30, outputTokens: 5, cacheReadTokens: 20 });
  });

  test("reasoning → output_config.effort ; absent si non demandé", async () => {
    const { provider, requests } = create([anthropicMessage('{"level":"C1","since":"2019"}')]);
    await generateObject({ ...base, provider, reasoning: "low" });
    await generateObject({ ...base, provider });
    expect(requests[0].output_config.effort).toBe("low");
    expect(requests[1].output_config.effort).toBeUndefined();
  });

  test("relance : contenu assistant renvoyé tel quel, puis l'erreur Zod", async () => {
    const first = anthropicMessage('{"level":"C1","since":"depuis 2019"}');
    const { provider, requests } = create([first, anthropicMessage('{"level":"C1","since":"2019"}')]);
    const result = await generateObject({ ...base, provider });

    expect(result.usage.attempts).toBe(2);
    expect(result.usage.inputTokens).toBe(60);
    const messages = requests[1].messages;
    expect(messages.map((m: { role: string }) => m.role)).toEqual(["user", "assistant", "user"]);
    expect(messages[1].content).toEqual(first.content);
    expect(messages[2].content).toContain("since");
  });

  test("429 : LLMRateLimitError avec le délai retry-after", async () => {
    const error = new Anthropic.RateLimitError(429, {}, "rate limited", new Headers({ "retry-after": "12" }));
    const { provider } = create([error]);
    const promise = generateObject({ ...base, provider });

    await expect(promise).rejects.toBeInstanceOf(LLMRateLimitError);
    await expect(promise).rejects.toMatchObject({ retryAfterSeconds: 12, provider: "anthropic" });
  });

  test("refus et sortie tronquée : LLMResponseError explicite", async () => {
    const refused = create([anthropicMessage("", { stop_reason: "refusal" })]);
    await expect(generateObject({ ...base, provider: refused.provider })).rejects.toBeInstanceOf(LLMResponseError);
    const truncated = create([anthropicMessage('{"lev', { stop_reason: "max_tokens" })]);
    await expect(generateObject({ ...base, provider: truncated.provider })).rejects.toThrow(/tronquée/);
  });
});

const geminiResponse = (text: string) => ({
  text,
  candidates: [{ finishReason: "STOP" }],
  usageMetadata: { promptTokenCount: 40, candidatesTokenCount: 8, thoughtsTokenCount: 12, cachedContentTokenCount: 5 },
});

describe("provider gemini", () => {
  const create = (responses: Array<ReturnType<typeof geminiResponse> | Error>) => {
    const fake = fakeClient(responses);
    const client = { models: { generateContent: fake.call } } as never;
    return { provider: createGeminiProvider({ apiKey: "k", model: "test-flash", client }), requests: fake.requests };
  };

  test("responseMimeType JSON + responseJsonSchema filtré, tokens de réflexion comptés en sortie", async () => {
    const { provider, requests } = create([geminiResponse('{"level":"B2","since":"2019"}')]);
    const result = await generateObject({ ...base, provider });

    expect(result.data.level).toBe("B2");
    const { config, model, contents } = requests[0];
    expect(model).toBe("test-flash");
    expect(config.responseMimeType).toBe("application/json");
    expect(config.systemInstruction).toBe("Extract the level.");
    expect(config.responseJsonSchema.properties.level.enum).toEqual(["B2", "C1"]);
    expect(JSON.stringify(config.responseJsonSchema)).not.toContain("pattern");
    expect(contents).toEqual([{ role: "user", parts: [{ text: "Anglais courant depuis 2019" }] }]);
    expect(result.usage).toMatchObject({ provider: "gemini", inputTokens: 40, outputTokens: 20, cacheReadTokens: 5 });
  });

  test("reasoning → thinkingConfig.thinkingLevel ; absent si non demandé", async () => {
    const { provider, requests } = create([geminiResponse('{"level":"B2","since":"2019"}')]);
    await generateObject({ ...base, provider, reasoning: "low" });
    await generateObject({ ...base, provider, reasoning: "high" });
    await generateObject({ ...base, provider });
    expect(requests[0].config.thinkingConfig).toEqual({ thinkingLevel: "LOW" });
    expect(requests[1].config.thinkingConfig).toEqual({ thinkingLevel: "HIGH" });
    expect(requests[2].config.thinkingConfig).toBeUndefined();
  });

  test("relance : tour model avec la réponse précédente puis tour user avec l'erreur", async () => {
    const { provider, requests } = create([geminiResponse('{"level":"B2","since":"2k19"}'), geminiResponse('{"level":"B2","since":"2019"}')]);
    await generateObject({ ...base, provider });

    const contents = requests[1].contents;
    expect(contents.map((c: { role: string }) => c.role)).toEqual(["user", "model", "user"]);
    expect(contents[1].parts[0].text).toBe('{"level":"B2","since":"2k19"}');
    expect(contents[2].parts[0].text).toContain("since");
  });

  test("429 par minute : message clair avec le délai de RetryInfo", async () => {
    const message = JSON.stringify({
      error: {
        code: 429,
        status: "RESOURCE_EXHAUSTED",
        details: [
          { "@type": "type.googleapis.com/google.rpc.QuotaFailure", violations: [{ quotaId: "GenerateRequestsPerMinutePerProjectPerModel-FreeTier" }] },
          { "@type": "type.googleapis.com/google.rpc.RetryInfo", retryDelay: "37s" },
        ],
      },
    });
    const { provider } = create([new ApiError({ message, status: 429 })]);
    const promise = generateObject({ ...base, provider });

    await expect(promise).rejects.toMatchObject({ provider: "gemini", retryAfterSeconds: 37 });
    await expect(promise).rejects.toThrow("Limite de requêtes Gemini atteinte (niveau gratuit probable). Réessaie dans 37 s.");
  });

  test("429 quota quotidien : message dédié, pas de délai", async () => {
    const message = '{"error":{"code":429,"details":[{"violations":[{"quotaId":"GenerateRequestsPerDayPerProjectPerModel-FreeTier"}]},{"retryDelay":"20s"}]}}';
    const { provider } = create([new ApiError({ message, status: 429 })]);
    const promise = generateObject({ ...base, provider });

    await expect(promise).rejects.toMatchObject({ retryAfterSeconds: undefined });
    await expect(promise).rejects.toThrow(/Quota quotidien Gemini épuisé/);
  });

  test("autres erreurs API : propagées telles quelles", async () => {
    const { provider } = create([new ApiError({ message: "bad request", status: 400 })]);
    await expect(generateObject({ ...base, provider })).rejects.toBeInstanceOf(ApiError);
  });
});

describe("configuration (LLM_PROVIDER, LLM_MODEL)", () => {
  test("mock par défaut, variables vides ignorées", () => {
    expect(readLLMConfig({})).toEqual({ provider: "mock" });
    expect(readLLMConfig({ LLM_PROVIDER: "", LLM_MODEL: "" })).toEqual({ provider: "mock" });
    expect(getProvider({}).name).toBe("mock");
  });

  test("aucun modèle par défaut : LLM_MODEL obligatoire hors mock", () => {
    expect(() => readLLMConfig({ LLM_PROVIDER: "gemini", GEMINI_API_KEY: "k" })).toThrow(LLMConfigError);
    expect(() => readLLMConfig({ LLM_PROVIDER: "gemini", GEMINI_API_KEY: "k" })).toThrow(/LLM_MODEL/);
  });

  test("clé manquante ou provider inconnu : erreur explicite", () => {
    expect(() => readLLMConfig({ LLM_PROVIDER: "anthropic", LLM_MODEL: "m" })).toThrow(/ANTHROPIC_API_KEY/);
    expect(() => readLLMConfig({ LLM_PROVIDER: "openai" })).toThrow(LLMConfigError);
  });

  test("provider et modèle pris dans l'environnement", () => {
    const provider = getProvider({ LLM_PROVIDER: "anthropic", LLM_MODEL: "un-modele", ANTHROPIC_API_KEY: "k" });
    expect({ name: provider.name, model: provider.model }).toEqual({ name: "anthropic", model: "un-modele" });
  });
});
