import { extractText, getDocumentProxy } from "unpdf";
import { normalizeText } from "@/lib/offer/text";

export const MAX_PDF_BYTES = 5 * 1024 * 1024;
/** Images déjà redimensionnées dans le navigateur (2 000 px, JPEG) : bien en dessous en pratique. */
export const MAX_IMAGE_BYTES = 4 * 1024 * 1024;
/** Au-delà, ce n'est plus un CV (et le coût LLM devient inutile). Pas de troncature silencieuse : on refuse. */
export const MAX_CV_CHARS = 30_000;
/** En dessous, le PDF n'a pas de couche texte exploitable (scan, image). */
export const MIN_CV_CHARS = 50;

/** Erreur sur le fichier ou le texte fourni, à afficher telle quelle à l'utilisateur. */
export class CvInputError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CvInputError";
  }
}

/** Espaces et lignes vides normalisés, sans toucher au contenu. */
export const normalizeCvText = normalizeText;

const meaningfulLength = (text: string) => text.replace(/\s/g, "").length;

function checkLength(text: string): string {
  if (meaningfulLength(text) < MIN_CV_CHARS) {
    throw new CvInputError("Le texte du CV est vide ou trop court.");
  }
  if (text.length > MAX_CV_CHARS) {
    throw new CvInputError(
      `Le CV fait ${text.length.toLocaleString("fr-FR")} caractères, au-delà de la limite de ${MAX_CV_CHARS.toLocaleString("fr-FR")}. Colle seulement le contenu du CV.`,
    );
  }
  return text;
}

export function cvTextFromPaste(raw: string): string {
  return checkLength(normalizeCvText(raw));
}

/**
 * Texte d'un PDF (taille et en-tête déjà vérifiés par l'appelant).
 * null : pas de couche texte exploitable (scan, image) → lecture native par le modèle.
 */
export async function cvTextFromPdf(bytes: Uint8Array): Promise<string | null> {
  let pages: string[];
  try {
    const pdf = await getDocumentProxy(bytes);
    ({ text: pages } = await extractText(pdf));
  } catch {
    throw new CvInputError("Impossible de lire ce PDF (fichier corrompu ou protégé).");
  }

  const text = normalizeCvText(pages.join("\n\n"));
  return meaningfulLength(text) < MIN_CV_CHARS ? null : checkLength(text);
}
