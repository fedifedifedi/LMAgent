import { EVIDENCE_ISSUE_KINDS, type LetterIssue } from "@/lib/agent/letter-checks";
import { normalize } from "@/lib/agent/evidence-checks";
import type { LetterContent } from "@/lib/agent/schemas";

/**
 * Relecture des preuves, rendue visible : le code trouve les affirmations sans source, l'agent les corrige, l'interface
 * montre chaque phrase avant / après avec la raison (« Relecture : 2 affirmations sans source retirées, 1 verbe corrigé »).
 */

/** Clé de l'étape « Relecture » dans la frise (étape du code, pas un événement Cominty). */
export const REVIEW_STEP_KEY = "review:final";

export type ReviewOutcome = "pending" | "corrected" | "removed" | "unchanged";

export type ReviewChange = {
  kind: LetterIssue["kind"];
  reason: string;
  before: string;
  after: string | null;
  outcome: ReviewOutcome;
};

export type LetterReview = {
  /** clean : rien à corriger ; correcting : correction demandée à l'agent ; done : corrigée ; reported : signalée sans correction. */
  status: "clean" | "correcting" | "done" | "reported";
  changes: ReviewChange[];
  at: string;
};

/** Affirmations sans source (terme de l'offre, statut transféré, compétence absente) et verbes renforcés. */
const UNSOURCED = new Set<LetterIssue["kind"]>(["offer_term_unsourced", "status_transferred", "claims_missing_skill"]);

const contentWords = (text: string) => new Set(normalize(text).split(" ").filter((w) => w.length >= 4));

function similarity(a: string, b: string): number {
  const [x, y] = [contentWords(a), contentWords(b)];
  if (x.size === 0 || y.size === 0) return 0;
  let shared = 0;
  for (const w of x) if (y.has(w)) shared++;
  return shared / (x.size + y.size - shared);
}

const SIMILAR_ENOUGH = 0.3;

/** Avant la correction : une ligne par problème de preuve, phrase d'origine conservée. */
export function startReview(issues: LetterIssue[], status: "correcting" | "reported"): LetterReview {
  const evidence = issues.filter((issue) => EVIDENCE_ISSUE_KINDS.has(issue.kind) && issue.sentence);
  if (evidence.length === 0) return { status: "clean", changes: [], at: new Date().toISOString() };
  return {
    status,
    changes: evidence.map((issue) => ({ kind: issue.kind, reason: issue.message, before: issue.sentence!, after: null, outcome: status === "correcting" ? "pending" : "unchanged" })),
    at: new Date().toISOString(),
  };
}

/** Après la correction : chaque phrase d'origine est retrouvée (même texte, phrase voisine) ou déclarée retirée. */
export function completeReview(review: LetterReview, after: LetterContent, afterIssues: LetterIssue[]): LetterReview {
  const sentences = after.paragraphs.flatMap((p) => p.sentences.map((s) => s.text));
  const stillFlagged = new Set(afterIssues.map((issue) => issue.message));
  return {
    status: "done",
    at: new Date().toISOString(),
    changes: review.changes.map((change) => {
      if (sentences.includes(change.before)) {
        return { ...change, after: change.before, outcome: stillFlagged.has(change.reason) ? "unchanged" : "corrected" };
      }
      const best = sentences.map((s) => ({ s, score: similarity(change.before, s) })).sort((a, b) => b.score - a.score)[0];
      return best && best.score >= SIMILAR_ENOUGH ? { ...change, after: best.s, outcome: "corrected" } : { ...change, after: null, outcome: "removed" };
    }),
  };
}

const plural = (n: number, one: string, many: string) => `${n} ${n > 1 ? many : one}`;

/** Libellé de l'étape « Relecture » dans la frise. */
export function reviewLabel(review: LetterReview): string {
  if (review.status === "clean") return "Relecture : aucune affirmation sans source";
  if (review.status === "correcting") return `Relecture : ${plural(review.changes.length, "point trouvé", "points trouvés")}, correction demandée à l'agent…`;
  const count = (test: (c: ReviewChange) => boolean) => review.changes.filter(test).length;
  const parts = [
    count((c) => UNSOURCED.has(c.kind) && c.outcome === "removed") && plural(count((c) => UNSOURCED.has(c.kind) && c.outcome === "removed"), "affirmation sans source retirée", "affirmations sans source retirées"),
    count((c) => UNSOURCED.has(c.kind) && c.outcome === "corrected") && plural(count((c) => UNSOURCED.has(c.kind) && c.outcome === "corrected"), "affirmation sans source corrigée", "affirmations sans source corrigées"),
    count((c) => c.kind === "verb_inflated" && c.outcome !== "unchanged") && plural(count((c) => c.kind === "verb_inflated" && c.outcome !== "unchanged"), "verbe corrigé", "verbes corrigés"),
    count((c) => c.outcome === "unchanged") && plural(count((c) => c.outcome === "unchanged"), "point restant à vérifier", "points restants à vérifier"),
  ].filter(Boolean);
  return `Relecture : ${parts.join(", ")}`;
}
