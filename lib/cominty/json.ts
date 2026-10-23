/**
 * Extrait l'objet JSON d'une réponse de l'agent. Au test réel, l'agent a renvoyé le JSON dans un bloc ```json suivi
 * de notes en Markdown (« Extraction notes », tableau) : on prend le premier bloc de code, sinon le premier objet
 * équilibré { … } du texte, sinon le texte tel quel (l'erreur JSON sera renvoyée à l'agent).
 */
export function extractJsonText(text: string): string {
  const trimmed = text.trim();
  const fenced = /```(?:json)?\s*\n?([\s\S]*?)```/i.exec(trimmed);
  if (fenced && fenced[1].trim().startsWith("{")) return fenced[1].trim();
  const start = trimmed.indexOf("{");
  if (start < 0) return trimmed;
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let i = start; i < trimmed.length; i++) {
    const char = trimmed[i];
    if (inString) {
      if (escaped) escaped = false;
      else if (char === "\\") escaped = true;
      else if (char === '"') inString = false;
      continue;
    }
    if (char === '"') inString = true;
    else if (char === "{") depth++;
    else if (char === "}" && --depth === 0) return trimmed.slice(start, i + 1);
  }
  return trimmed;
}
