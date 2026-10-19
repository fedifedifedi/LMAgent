import { describe, expect, test } from "bun:test";
import { z } from "zod";
import { LLMValidationError } from "@/lib/llm/errors";
import { generateObject, MAX_ATTEMPTS } from "@/lib/llm/generate";
import { createMockProvider } from "@/lib/llm/providers/mock";
import type { CompletionRequest, LLMProvider, LLMUsage } from "@/lib/llm/types";
import { LLM_OUTPUTS } from "@/lib/schemas/llm-outputs";

const output = {
  name: "level",
  schema: z.object({ level: z.enum(["B2", "C1"]) }),
  lenientSchema: z.object({ level: z.string().optional().catch(undefined), note: z.string().default("ok") }),
};

/** Mock qui enregistre chaque requête reçue. */
function recordingMock(fixtures: Record<string, unknown>) {
  const requests: CompletionRequest[] = [];
  const inner = createMockProvider(fixtures);
  const provider: LLMProvider = {
    ...inner,
    complete: (request) => {
      requests.push(structuredClone(request));
      return inner.complete(request);
    },
  };
  return { provider, requests };
}

const base = { system: "Extract.", prompt: "Niveau : courant" };

describe("generateObject", () => {
  test("succès au premier appel : schéma tolérant appliqué, tokens estimés", async () => {
    const { provider, requests } = recordingMock({ level: { level: "C1" } });
    const result = await generateObject({ ...base, output, provider });

    expect(result).toMatchObject({ data: { level: "C1", note: "ok" }, degraded: false });
    expect(result.usage).toMatchObject({ provider: "mock", model: "mock", attempts: 1, estimated: true });
    expect(result.usage.inputTokens).toBeGreaterThan(0);
    expect(requests[0].jsonSchema).toMatchObject({ properties: { level: { enum: ["B2", "C1"] } } });
  });

  test("sortie invalide puis valide : relance avec l'erreur Zod renvoyée au modèle", async () => {
    const { provider, requests } = recordingMock({ level: [{ level: "courant" }, { level: "B2" }] });
    const result = await generateObject({ ...base, output, provider });

    expect(result.data.level).toBe("B2");
    expect(result.usage.attempts).toBe(2);
    const retry = requests[1].turns;
    expect(retry.map((turn) => turn.role)).toEqual(["user", "assistant", "user"]);
    expect(retry[1].text).toBe('{"level":"courant"}');
    expect(retry[2].text).toContain("level");
    expect(retry[2].text).toContain("does not match");
  });

  test("JSON invalide : relance avec l'erreur de parsing", async () => {
    const { provider, requests } = recordingMock({ level: ["{level: oops", { level: "C1" }] });
    const result = await generateObject({ ...base, output, provider });

    expect(result.usage.attempts).toBe(2);
    expect(requests[1].turns[2].text).toContain("Invalid JSON");
  });

  test(`${MAX_ATTEMPTS} échecs sans schéma tolérant : LLMValidationError, tokens cumulés`, async () => {
    const { provider, requests } = recordingMock({ level: { level: "courant" } });
    let usageSeen: LLMUsage | undefined;
    const promise = generateObject({
      ...base,
      output: { name: "level", schema: output.schema },
      provider,
      onUsage: (usage) => (usageSeen = usage),
    });

    await expect(promise).rejects.toBeInstanceOf(LLMValidationError);
    const error = (await promise.catch((e) => e)) as LLMValidationError;
    expect(requests).toHaveLength(MAX_ATTEMPTS);
    expect(error.usage.attempts).toBe(MAX_ATTEMPTS);
    expect(error.lastResponse).toBe('{"level":"courant"}');
    expect(usageSeen?.outputTokens).toBe(error.usage.outputTokens);
    expect(error.usage.outputTokens).toBeGreaterThan(requests.length - 1);
  });

  test(`${MAX_ATTEMPTS} échecs avec schéma tolérant : sortie récupérée, marquée degraded`, async () => {
    const { provider } = recordingMock({ level: { level: "courant" } });
    const result = await generateObject({ ...base, output, provider });

    expect(result).toMatchObject({ data: { level: "courant", note: "ok" }, degraded: true });
    expect(result.issues).toContain("level");
    expect(result.usage.attempts).toBe(MAX_ATTEMPTS);
  });

  test("profile_draft avec la fixture par défaut : brouillon complété par le schéma tolérant", async () => {
    const result = await generateObject({ ...base, output: LLM_OUTPUTS.profile_draft, provider: createMockProvider() });
    expect(result.degraded).toBe(false);
    expect(result.data.identity.firstName).toBe("Camille");
    expect(result.data.interests).toEqual([]);
    expect(result.data.availability.contractTypes).toEqual([]);
  });

  test("fixture manquante : erreur de configuration explicite", async () => {
    await expect(
      generateObject({ ...base, output: { name: "inconnu", schema: output.schema }, provider: createMockProvider({}) }),
    ).rejects.toThrow(/lib\/llm\/fixtures\/inconnu\.json/);
  });
});
