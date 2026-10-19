/** Espaces et lignes vides normalisés, sans toucher au contenu (offre collée ou récupérée). */
export function normalizeText(text: string): string {
  return text
    .replace(/\r\n?/g, "\n")
    .replace(/[\t\f\v ]+/g, " ")
    .split("\n")
    .map((line) => line.replace(/ {2,}/g, " ").trim())
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

export const MIN_PASTED_OFFER_CHARS = 200;
export const MAX_OFFER_CHARS = 30_000;
