import "server-only";
import { cookies } from "next/headers";
import { createComintyClient } from "@/lib/cominty/client";
import { readComintyConfig } from "@/lib/cominty/config";
import { ACCESS_COOKIE, ACCESS_REQUIRED_MESSAGE, ComintyGuardError, cookieGrantsAccess, guardedClient } from "@/lib/cominty/guard";
import { getMockComintyClient, type AgentClient } from "@/lib/cominty/mock-client";
import { createReplayClient, REPLAY_PREFIX } from "@/lib/cominty/replay-client";

type Env = Record<string, string | undefined>;

export const isComintyMode = (env: Env = process.env) => env.LLM_PROVIDER === "cominty";

/** Le visiteur a saisi le bon code d'accès (ou aucun code n'est exigé : développement local sans DEMO_ACCESS_CODE). */
export async function requestHasAccess(env: Env = process.env): Promise<boolean> {
  const store = await cookies();
  return cookieGrantsAccess(store.get(ACCESS_COOKIE)?.value, env);
}

/** Vrai Cominty, protégé : plafond vérifié avant chaque message, coût enregistré à chaque réponse. */
export function realClient(env: Env = process.env): AgentClient {
  return guardedClient(createComintyClient(readComintyConfig(env)), env);
}

/** Client capable de suivre un message existant, choisi d'après son id : rejeu, faux agent ou vrai Cominty. */
export function clientForMessage(messageId: string, env: Env = process.env): AgentClient {
  if (messageId.startsWith(REPLAY_PREFIX)) return createReplayClient();
  if (messageId.startsWith("mock-")) return getMockComintyClient();
  return realClient(env);
}

/**
 * Client pour démarrer une lettre : faux agent hors mode cominty ; vrai Cominty avec le code d'accès ;
 * rejeu d'un vrai run enregistré pour la lettre de démo sans code ; sinon refus (aucun appel payant sans code).
 */
export function clientForStart({ access, demo }: { access: boolean; demo: boolean }, env: Env = process.env): AgentClient {
  if (!isComintyMode(env)) return getMockComintyClient();
  if (access) return realClient(env);
  if (demo) return createReplayClient();
  throw new ComintyGuardError("access", ACCESS_REQUIRED_MESSAGE);
}
