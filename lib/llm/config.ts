import "server-only";
import { z } from "zod";
import { LLMConfigError } from "@/lib/llm/errors";

/**
 * Toute l'IA passe par l'agent managé Cominty (exigence du challenge) ; le mock sert aux tests et à la démo locale.
 * La configuration de Cominty (COMINTY_*) est lue par lib/cominty/config.ts.
 */
const EnvSchema = z.object({
  LLM_PROVIDER: z.preprocess((value) => (value === "" ? undefined : value), z.enum(["mock", "cominty"]).default("mock")),
});

export type LLMConfig = { provider: "mock" | "cominty" };

/** Lue au premier appel (pas à l'import) : le build et le mock tournent sans configuration. */
export function readLLMConfig(env: Record<string, string | undefined> = process.env): LLMConfig {
  const parsed = EnvSchema.safeParse({ LLM_PROVIDER: env.LLM_PROVIDER });
  if (!parsed.success) {
    // La valeur reçue n'est pas un secret : l'afficher permet de trouver d'où elle vient (souvent un ancien .env.local).
    throw new LLMConfigError(
      `LLM_PROVIDER vaut « ${env.LLM_PROVIDER} », valeur qui n'existe plus (Gemini et Anthropic ont été retirés). ` +
        "Mets LLM_PROVIDER=cominty (agent réel) ou LLM_PROVIDER=mock (démo hors ligne) dans .env.local ou dans les variables " +
        "d'environnement (Railway), puis redémarre le serveur.",
    );
  }
  return { provider: parsed.data.LLM_PROVIDER };
}
