import "server-only";
import { z } from "zod";
import { LLMConfigError } from "@/lib/llm/errors";

// Une variable vide (ex. "LLM_MODEL=" dans .env.local) compte comme absente.
const optionalString = z.preprocess((value) => (value === "" ? undefined : value), z.string().trim().min(1).optional());

const EnvSchema = z.object({
  LLM_PROVIDER: z.preprocess(
    (value) => (value === "" ? undefined : value),
    z.enum(["mock", "anthropic", "gemini"]).default("mock"),
  ),
  LLM_MODEL: optionalString,
  /** Modèle plus léger pour les étapes de recopie et de comparaison (analyse d'offre, correspondance). */
  LLM_MODEL_FAST: optionalString,
  ANTHROPIC_API_KEY: optionalString,
  GEMINI_API_KEY: optionalString,
});

export type LLMConfig =
  | { provider: "mock" }
  | { provider: "anthropic" | "gemini"; model: string; apiKey: string };

/**
 * "default" : rédaction, critique, réécriture, extraction du CV (LLM_MODEL).
 * "fast" : analyzeOffer et matchProfile (LLM_MODEL_FAST, sinon LLM_MODEL) — économise le quota.
 */
export type ModelTier = "default" | "fast";

/** Lue au premier appel (pas à l'import) : le build et le mock tournent sans configuration. */
export function readLLMConfig(env: Record<string, string | undefined> = process.env, tier: ModelTier = "default"): LLMConfig {
  const parsed = EnvSchema.safeParse(env);
  if (!parsed.success) {
    throw new LLMConfigError(`Configuration LLM invalide dans .env.local :\n${z.prettifyError(parsed.error)}`);
  }
  const { LLM_PROVIDER: provider, LLM_MODEL: mainModel, LLM_MODEL_FAST: fastModel } = parsed.data;
  const model = tier === "fast" ? (fastModel ?? mainModel) : mainModel;
  if (provider === "mock") return { provider };

  const keyName = provider === "anthropic" ? "ANTHROPIC_API_KEY" : "GEMINI_API_KEY";
  const apiKey = parsed.data[keyName];
  if (!model) {
    throw new LLMConfigError(`LLM_PROVIDER=${provider} : définis LLM_MODEL dans .env.local (aucun modèle par défaut).`);
  }
  if (!apiKey) throw new LLMConfigError(`LLM_PROVIDER=${provider} : définis ${keyName} dans .env.local.`);
  return { provider, model, apiKey };
}
