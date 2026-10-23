import "server-only";
import { z } from "zod";
import { LLMConfigError } from "@/lib/llm/errors";

/**
 * Toute l'IA passe par l'agent managé Cominty (exigence du challenge) ; le mock sert aux tests et à la démo locale.
 * La configuration de Cominty (COMINTY_*) est lue par lib/cominty/config.ts.
 */
const EnvSchema = z.object({
  LLM_PROVIDER: z.preprocess(
    (value) => (value === "" ? undefined : value),
    z.enum(["mock", "cominty"], { error: "LLM_PROVIDER doit valoir mock ou cominty (Gemini et Anthropic ont été retirés)." }).default("mock"),
  ),
});

export type LLMConfig = { provider: "mock" | "cominty" };

/** Lue au premier appel (pas à l'import) : le build et le mock tournent sans configuration. */
export function readLLMConfig(env: Record<string, string | undefined> = process.env): LLMConfig {
  const parsed = EnvSchema.safeParse({ LLM_PROVIDER: env.LLM_PROVIDER });
  if (!parsed.success) {
    throw new LLMConfigError(`Configuration invalide dans .env.local : ${parsed.error.issues.map((i) => i.message).join(" ; ")}`);
  }
  return { provider: parsed.data.LLM_PROVIDER };
}
