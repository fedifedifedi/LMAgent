import { z } from "zod";
import { LLMValidationError } from "@/lib/llm/errors";
import { toTargetJsonSchema } from "@/lib/llm/json-schema";
import type { ConversationTurn, LLMOutput, LLMProvider, LLMUsage, ReasoningLevel } from "@/lib/llm/types";

/** Appel initial + 2 relances. */
export const MAX_ATTEMPTS = 3;
export const DEFAULT_MAX_OUTPUT_TOKENS = 16000;

export type GenerateObjectRequest<T extends z.ZodObject, L extends z.ZodType> = {
  output: LLMOutput<T, L>;
  system: string;
  prompt: string;
  provider: LLMProvider;
  maxOutputTokens?: number;
  reasoning?: ReasoningLevel;
  /** Appelé une fois par appel, succès ou échec de validation, avec la consommation cumulée. */
  onUsage?: (usage: LLMUsage) => void;
};

export type GenerateObjectResult<T> = {
  data: T;
  usage: LLMUsage;
  /** true si le schéma cible n'a jamais été satisfait et que seul le schéma tolérant a pu récupérer la sortie. */
  degraded: boolean;
  /** Erreurs du schéma cible à la dernière tentative, quand degraded est true. */
  issues?: string;
};

function parseJson(text: string): { ok: true; value: unknown } | { ok: false; error: string } {
  try {
    return { ok: true, value: JSON.parse(text) };
  } catch (error) {
    return { ok: false, error: `Invalid JSON: ${error instanceof Error ? error.message : String(error)}` };
  }
}

function feedbackMessage(issues: string) {
  return [
    "Your previous answer does not match the required JSON schema.",
    "Errors:",
    issues,
    "Return the corrected JSON object only. Do not invent information that is not in the input.",
  ].join("\n");
}

/**
 * Boucle commune à tous les providers : appel, validation Zod du schéma cible, relance avec l'erreur
 * renvoyée au modèle (MAX_ATTEMPTS appels au plus), puis schéma tolérant en dernier recours.
 */
export async function generateObject<T extends z.ZodObject, L extends z.ZodType = T>(
  request: GenerateObjectRequest<T, L>,
): Promise<GenerateObjectResult<z.output<L>>> {
  const { output, provider } = request;
  const jsonSchema = toTargetJsonSchema(output.schema);
  const turns: ConversationTurn[] = [{ role: "user", text: request.prompt }];
  const startedAt = performance.now();

  const usage: LLMUsage = {
    provider: provider.name,
    model: provider.model,
    attempts: 0,
    durationMs: 0,
    inputTokens: 0,
    outputTokens: 0,
  };
  const finish = () => {
    usage.durationMs = Math.round(performance.now() - startedAt);
    request.onUsage?.(usage);
  };

  // Le schéma tolérant s'applique à l'entrée brute (même JSON que celui validé par le schéma cible).
  const finalize = (raw: unknown, parsed: unknown) =>
    (output.lenientSchema ? output.lenientSchema.parse(raw) : parsed) as z.output<L>;

  let lastText = "";
  let lastIssues = "";
  let lastJson: { value: unknown } | undefined;

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    const completion = await provider.complete({
      name: output.name,
      jsonSchema,
      system: request.system,
      turns,
      maxOutputTokens: request.maxOutputTokens ?? DEFAULT_MAX_OUTPUT_TOKENS,
      reasoning: request.reasoning,
    });

    usage.attempts = attempt;
    usage.inputTokens += completion.usage.inputTokens;
    usage.outputTokens += completion.usage.outputTokens;
    if (completion.usage.cacheReadTokens !== undefined) {
      usage.cacheReadTokens = (usage.cacheReadTokens ?? 0) + completion.usage.cacheReadTokens;
    }
    if (completion.usage.estimated) usage.estimated = true;

    lastText = completion.text;
    const json = parseJson(completion.text);
    if (json.ok) {
      lastJson = { value: json.value };
      const result = output.schema.safeParse(json.value);
      if (result.success) {
        finish();
        return { data: finalize(json.value, result.data), usage, degraded: false };
      }
      lastIssues = z.prettifyError(result.error);
    } else {
      lastIssues = json.error;
    }

    turns.push({ role: "assistant", text: completion.text, native: completion.native });
    turns.push({ role: "user", text: feedbackMessage(lastIssues) });
  }

  finish();
  if (output.lenientSchema && lastJson) {
    const lenient = output.lenientSchema.safeParse(lastJson.value);
    if (lenient.success) {
      return { data: lenient.data as z.output<L>, usage, degraded: true, issues: lastIssues };
    }
  }
  throw new LLMValidationError(output.name, lastIssues, lastText, usage);
}
