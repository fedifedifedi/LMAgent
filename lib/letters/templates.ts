/** Templates de mise en page de la lettre, communs à l'aperçu et au PDF (components/letter/letter-document.tsx). */
export const LETTER_TEMPLATES = {
  moderne: { label: "Moderne", description: "Nom en grand, filet encre, coordonnées sur une ligne.", basePt: 11 },
  classique: { label: "Classique", description: "Expéditeur à gauche, destinataire et date à droite.", basePt: 11 },
  compact: { label: "Compact", description: "Marges réduites, pour les lettres longues.", basePt: 10.5 },
} as const;

export type LetterTemplate = keyof typeof LETTER_TEMPLATES;
/** Choix de l'utilisateur : Moderne par défaut ; Classique et Compact restent au choix sur chaque lettre. */
export const DEFAULT_TEMPLATE: LetterTemplate = "moderne";

/** Taille de texte minimale (environ 10 pt) quand la lettre est réduite pour tenir sur une page. */
export const MIN_LETTER_PT = 10;

export function isLetterTemplate(value: unknown): value is LetterTemplate {
  return typeof value === "string" && value in LETTER_TEMPLATES;
}

/** Facteur d'échelle minimal pour un template (10 pt / taille de base). */
export const minScale = (template: LetterTemplate) => MIN_LETTER_PT / LETTER_TEMPLATES[template].basePt;
