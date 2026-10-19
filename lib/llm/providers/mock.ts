import { LLMConfigError } from "@/lib/llm/errors";
import { MOCK_FIXTURES } from "@/lib/llm/fixtures";
import type { LLMProvider } from "@/lib/llm/types";

const estimateTokens = (text: string) => Math.ceil(text.length / 4);
/** Forfait par fichier joint (image ou page de PDF lue nativement) : ordre de grandeur, pas un comptage. */
const ATTACHMENT_TOKENS = 1000;

/** Ids autorisés pour les sources (enum de la propriété sourceIds du JSON Schema), s'il y en a. */
function findSourceEnum(schema: unknown): string[] | undefined {
  if (!schema || typeof schema !== "object") return undefined;
  const node = schema as Record<string, unknown>;
  const properties = node.properties as Record<string, Record<string, unknown>> | undefined;
  const items = properties?.sourceIds?.items as { enum?: string[] } | undefined;
  if (items?.enum?.length) return items.enum;
  for (const value of Object.values(node)) {
    const found = Array.isArray(value) ? value.map(findSourceEnum).find(Boolean) : findSourceEnum(value);
    if (found) return found;
  }
  return undefined;
}

/** "{{source:N}}" → N-ième id de source autorisé (modulo) : les fixtures restent valides quel que soit le profil. */
function fillSourceIds(text: string, schema: unknown): string {
  if (!text.includes("{{source:")) return text;
  const ids = findSourceEnum(schema) ?? [];
  return text.replace(/\{\{source:(\d+)\}\}/g, (_, n: string) => ids[Number(n) % Math.max(ids.length, 1)] ?? "");
}

/**
 * Provider sans réseau ni clé. Fixture par sortie : un objet (toujours la même réponse) ou une liste de
 * réponses servies dans l'ordre des tentatives (la dernière est répétée). Une chaîne est renvoyée telle
 * quelle, ce qui permet de simuler un JSON invalide. Les fichiers joints (lecture native) sont acceptés :
 * la réponse vient de la même fixture, le mock ne lit pas le fichier.
 */
export function createMockProvider(fixtures: Record<string, unknown> = MOCK_FIXTURES): LLMProvider {
  return {
    name: "mock",
    model: "mock",
    async complete(request) {
      if (!(request.name in fixtures)) {
        throw new LLMConfigError(`Pas de fixture mock pour "${request.name}" : ajoute lib/llm/fixtures/${request.name}.json.`);
      }
      const fixture = fixtures[request.name];
      const responses = Array.isArray(fixture) ? fixture : [fixture];
      const attempt = request.turns.filter((turn) => turn.role === "assistant").length;
      const response = responses[Math.min(attempt, responses.length - 1)];
      const raw = typeof response === "string" ? response : JSON.stringify(response);
      const text = fillSourceIds(raw, request.jsonSchema);

      const prompt = [request.system, ...request.turns.map((turn) => turn.text)].join("\n");
      return {
        text,
        usage: {
          inputTokens: estimateTokens(prompt) + (request.attachments?.length ?? 0) * ATTACHMENT_TOKENS,
          outputTokens: estimateTokens(text),
          estimated: true,
        },
      };
    },
  };
}
