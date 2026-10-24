import { checkEvidence, type EvidenceContext } from "@/lib/agent/evidence-checks";
import type { LetterContent, OfferAnalysis, ProfileMatch } from "@/lib/agent/schemas";

export const MIN_WORDS = 250;
export const MAX_WORDS = 350;

export type LetterIssue = {
  kind:
    | "too_long"
    | "too_short"
    | "wrong_language"
    | "claims_missing_skill"
    | "addressing"
    // Relecture des preuves (lib/agent/evidence-checks.ts)
    | "offer_term_unsourced"
    | "status_transferred"
    | "verb_inflated"
    // Deux phrases voisines qui répètent les mêmes outils (après une correction, au test réel)
    | "repeated_terms";
  message: string;
  /** Phrase de la lettre concernée (relecture visible : avant / après). */
  sentence?: string;
};

/** Problèmes de preuve : ils déclenchent la correction (unique) demandée à l'agent. */
export const EVIDENCE_ISSUE_KINDS: ReadonlySet<LetterIssue["kind"]> = new Set(["claims_missing_skill", "offer_term_unsourced", "status_transferred", "verb_inflated"]);

const words = (text: string) => text.split(/\s+/).filter((word) => /[\p{L}\p{N}]/u.test(word)).length;

/** Mots du corps de la lettre (paragraphes), hors objet, formule d'appel et formule de politesse. */
export function letterWordCount(letter: LetterContent): number {
  return letter.paragraphs.reduce((total, p) => total + p.sentences.reduce((sum, s) => sum + words(s.text), 0), 0);
}

export function letterText(letter: LetterContent): string {
  return letter.paragraphs.map((p) => p.sentences.map((s) => s.text).join(" ")).join("\n\n");
}

const escapeRegExp = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** Le terme apparaît-il comme mot entier (insensible à la casse, lettres accentuées comprises) ? */
export function mentions(text: string, term: string): boolean {
  const cleaned = term.trim();
  if (cleaned.length < 2) return false;
  return new RegExp(`(?<![\\p{L}\\p{N}])${escapeRegExp(cleaned)}(?![\\p{L}\\p{N}])`, "iu").test(text);
}

/** Formulations d'apprentissage : seule façon de citer une compétence que le candidat souhaite apprendre. */
const LEARNING = /apprendre|me former|monter en comp[ée]tences?|d[ée]couvrir|learn/i;

/**
 * Vérifications déterministes, en plus de la critique du modèle : longueur, langue, compétences absentes du profil
 * revendiquées, formule d'appel quand l'offre nomme un contact.
 */
export function checkLetter(
  letter: LetterContent,
  context: { analysis: OfferAnalysis; match: ProfileMatch; evidence?: EvidenceContext; learning?: string[] },
): LetterIssue[] {
  const issues: LetterIssue[] = [];
  const count = letterWordCount(letter);
  if (count > MAX_WORDS) issues.push({ kind: "too_long", message: `La lettre fait ${count} mots : au-delà de ${MAX_WORDS}, elle risque de dépasser une page.` });
  if (count < MIN_WORDS) issues.push({ kind: "too_short", message: `La lettre fait ${count} mots : en dessous de ${MIN_WORDS}, elle manque d'arguments.` });

  if (letter.language !== context.analysis.language) {
    issues.push({ kind: "wrong_language", message: `La lettre n'est pas dans la langue de l'offre (${context.analysis.language === "fr" ? "français" : "anglais"}).` });
  }

  const text = `${letter.subject}\n${letterText(letter)}`;
  const sentences = letter.paragraphs.flatMap((p) => p.sentences.map((s) => s.text));
  for (const requirement of context.match.requirements) {
    if (requirement.status === "missing" && mentions(text, requirement.name)) {
      // « Non, mais je souhaite l'apprendre » : la mention n'est permise que dans une phrase d'apprentissage.
      const learnable = context.learning?.some((name) => name.toLocaleLowerCase("fr") === requirement.name.toLocaleLowerCase("fr"));
      const claiming = sentences.filter((s) => mentions(s, requirement.name) && !(learnable && LEARNING.test(s)));
      if (claiming.length === 0 && !mentions(letter.subject, requirement.name)) continue;
      const sentence = claiming[0];
      issues.push({ kind: "claims_missing_skill", message: `La lettre mentionne « ${requirement.name} », absent du profil.`, ...(sentence ? { sentence } : {}) });
    }
  }

  const contact = context.analysis.contact?.name.trim();
  if (contact) {
    const lastName = contact.split(/\s+/).at(-1) ?? contact;
    if (!mentions(letter.salutation, lastName)) {
      issues.push({ kind: "addressing", message: `L'offre nomme ${contact} : la lettre devrait s'adresser à cette personne.` });
    }
  }
  issues.push(...repeatedTerms(letter));
  if (context.evidence) issues.push(...checkEvidence(letter, { ...context.evidence, analysis: context.analysis }));
  return issues;
}

/** Noms propres et outils d'une phrase (mots à majuscule hors premier mot : StackStorm, Vault, Grafana). */
const properNames = (text: string) => new Set(text.split(/[^\p{L}\p{N}+#.]+/u).slice(1).filter((w) => /^\p{Lu}/u.test(w) && w.length >= 3));

/** Deux phrases consécutives d'un paragraphe qui citent au moins 3 mêmes noms : répétition à reformuler. */
export function repeatedTerms(letter: LetterContent): LetterIssue[] {
  const issues: LetterIssue[] = [];
  for (const paragraph of letter.paragraphs) {
    paragraph.sentences.forEach((sentence, index) => {
      const next = paragraph.sentences[index + 1];
      if (!next) return;
      const shared = [...properNames(sentence.text)].filter((name) => properNames(next.text).has(name));
      if (shared.length >= 3) {
        issues.push({ kind: "repeated_terms", sentence: next.text, message: `Deux phrases voisines répètent ${shared.join(", ")} : regroupe-les ou retire la répétition.` });
      }
    });
  }
  return issues;
}