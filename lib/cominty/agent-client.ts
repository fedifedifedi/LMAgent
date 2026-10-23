import "server-only";
import { createComintyClient } from "@/lib/cominty/client";
import { readComintyConfig } from "@/lib/cominty/config";
import { getMockComintyClient, type AgentClient } from "@/lib/cominty/mock-client";

/**
 * Client de l'agent pour les lettres : le vrai Cominty quand LLM_PROVIDER=cominty, sinon le faux agent (mock, défaut)
 * pour les tests, les captures et le développement sans crédit.
 */
export function getAgentClient(env: Record<string, string | undefined> = process.env): AgentClient {
  return env.LLM_PROVIDER === "cominty" ? createComintyClient(readComintyConfig(env)) : getMockComintyClient();
}
