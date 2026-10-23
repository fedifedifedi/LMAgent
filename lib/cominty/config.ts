import { z } from "zod";
import { ComintyConfigError } from "@/lib/cominty/errors";

export const DEFAULT_COMINTY_BASE_URL = "https://ds.cominty.com";

/** Identifiant Cominty (Clerk) : "user_" + au moins 20 caractères alphanumériques. */
const USER_ID_PATTERN = /^user_[A-Za-z0-9]{20,}$/;

const EnvSchema = z.object({
  COMINTY_API_KEY: z.string().trim().min(1, "COMINTY_API_KEY manquante"),
  COMINTY_USER_ID: z.string().trim().regex(USER_ID_PATTERN, "COMINTY_USER_ID manquant ou mal formé (attendu : user_…)"),
  COMINTY_AGENT_ID: z.string().trim().min(1, "COMINTY_AGENT_ID manquant"),
  COMINTY_BASE_URL: z.string().trim().url("COMINTY_BASE_URL invalide").optional(),
});

export type ComintyConfig = { apiKey: string; userId: string; agentId: string; baseUrl: string };

/** Lit la configuration Cominty (côté serveur uniquement). Les messages d'erreur ne contiennent jamais les valeurs. */
export function readComintyConfig(env: Record<string, string | undefined> = process.env): ComintyConfig {
  const parsed = EnvSchema.safeParse({
    COMINTY_API_KEY: env.COMINTY_API_KEY,
    COMINTY_USER_ID: env.COMINTY_USER_ID,
    COMINTY_AGENT_ID: env.COMINTY_AGENT_ID,
    COMINTY_BASE_URL: env.COMINTY_BASE_URL || undefined,
  });
  if (!parsed.success) {
    const problems = parsed.error.issues.map((issue) => issue.message).join(" ; ");
    throw new ComintyConfigError(`Configuration Cominty incomplète dans .env.local : ${problems}.`);
  }
  const { COMINTY_API_KEY, COMINTY_USER_ID, COMINTY_AGENT_ID, COMINTY_BASE_URL } = parsed.data;
  return {
    apiKey: COMINTY_API_KEY,
    userId: COMINTY_USER_ID,
    agentId: COMINTY_AGENT_ID,
    baseUrl: (COMINTY_BASE_URL ?? DEFAULT_COMINTY_BASE_URL).replace(/\/+$/, ""),
  };
}
