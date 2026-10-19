import { extractText, getDocumentProxy } from "unpdf";

export const MAX_PDF_BYTES = 5 * 1024 * 1024;
/** Au-delà, ce n'est plus un CV (et le coût LLM devient inutile). Pas de troncature silencieuse : on refuse. */
export const MAX_CV_CHARS = 30_000;
/** En dessous, le PDF n'a pas de couche texte exploitable (scan, image). */
export const MIN_CV_CHARS = 50;

/** Erreur à afficher telle quelle à l'utilisateur. */
export class CvTextError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CvTextError";
  }
}

/** Espaces et lignes vides normalisés, sans toucher au contenu. */
export function normalizeCvText(text: string): string {
  return text
    .replace(/\r\n?/g, "\n")
    .replace(/[\t\f\v ]+/g, " ")
    .split("\n")
    .map((line) => line.replace(/ {2,}/g, " ").trim())
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function checkLength(text: string): string {
  const length = text.replace(/\s/g, "").length;
  if (length < MIN_CV_CHARS) {
    throw new CvTextError("Le texte du CV est vide ou trop court.");
  }
  if (text.length > MAX_CV_CHARS) {
    throw new CvTextError(
      `Le CV fait ${text.length.toLocaleString("fr-FR")} caractères, au-delà de la limite de ${MAX_CV_CHARS.toLocaleString("fr-FR")}. Colle seulement le contenu du CV.`,
    );
  }
  return text;
}

export function cvTextFromPaste(raw: string): string {
  return checkLength(normalizeCvText(raw));
}

export async function cvTextFromPdf(bytes: Uint8Array): Promise<string> {
  if (bytes.byteLength > MAX_PDF_BYTES) {
    throw new CvTextError(`Le PDF dépasse ${MAX_PDF_BYTES / 1024 / 1024} Mo.`);
  }
  if (new TextDecoder().decode(bytes.subarray(0, 5)) !== "%PDF-") {
    throw new CvTextError("Le fichier n'est pas un PDF.");
  }

  let pages: string[];
  try {
    const pdf = await getDocumentProxy(bytes);
    ({ text: pages } = await extractText(pdf));
  } catch {
    throw new CvTextError("Impossible de lire ce PDF (fichier corrompu ou protégé).");
  }

  const text = normalizeCvText(pages.join("\n\n"));
  if (text.replace(/\s/g, "").length < MIN_CV_CHARS) {
    throw new CvTextError(
      "Aucun texte n'a pu être extrait de ce PDF : c'est probablement un scan ou une image. Colle le texte du CV à la place.",
    );
  }
  return checkLength(text);
}
