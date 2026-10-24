import { describe, expect, test } from "bun:test";
import type { LetterIssue } from "@/lib/agent/letter-checks";
import { completeReview, reviewLabel, startReview } from "@/lib/agent/review";
import type { LetterContent } from "@/lib/agent/schemas";

const letterOf = (texts: string[]): LetterContent => ({
  language: "fr",
  subject: "Candidature",
  salutation: "Bonjour,",
  paragraphs: [{ sentences: texts.map((text) => ({ text, sourceIds: ["exp"] })) }],
  closing: "Cordialement.",
});

const issues: LetterIssue[] = [
  { kind: "offer_term_unsourced", message: "« decoupage des documents » vient de l'offre, pas du CV.", sentence: "Chez Wind Consulting, j'ai travaillé sur le découpage des documents." },
  { kind: "status_transferred", message: "« livre a l equipe » est le statut de Wind Consulting, pas de Talan.", sentence: "Chez Talan, j'ai livré à l'équipe un assistant RAG." },
  { kind: "verb_inflated", message: "« concu » est plus fort que ce que dit le CV.", sentence: "Chez Talan, j'ai conçu une couche RAG." },
  { kind: "too_long", message: "La lettre fait 400 mots." },
];

describe("relecture visible", () => {
  test("avant la correction : une ligne par problème de preuve (pas la longueur), étape « en cours »", () => {
    const review = startReview(issues, "correcting");
    expect(review.status).toBe("correcting");
    expect(review.changes.map((c) => c.kind)).toEqual(["offer_term_unsourced", "status_transferred", "verb_inflated"]);
    expect(reviewLabel(review)).toBe("Relecture : 3 points trouvés, correction demandée à l'agent…");
  });

  test("après la correction : phrase retirée, phrase corrigée retrouvée par ressemblance, libellé du jury", () => {
    const after = letterOf([
      "Chez Talan, j'ai intégré une couche RAG dans un assistant livré prêt à l'emploi.",
      "Chez Talan, j'ai livré prêt à l'emploi un assistant RAG.",
      "Je serais ravi d'échanger avec vous.",
    ]);
    const done = completeReview(startReview(issues, "correcting"), after, []);
    expect(done.status).toBe("done");
    expect(done.changes[0]).toMatchObject({ outcome: "removed", after: null });
    expect(done.changes[1]).toMatchObject({ outcome: "corrected", after: "Chez Talan, j'ai livré prêt à l'emploi un assistant RAG." });
    expect(done.changes[2]).toMatchObject({ outcome: "corrected", after: "Chez Talan, j'ai intégré une couche RAG dans un assistant livré prêt à l'emploi." });
    expect(reviewLabel(done)).toBe("Relecture : 1 affirmation sans source retirée, 1 affirmation sans source corrigée, 1 verbe corrigé");
  });

  test("phrase identique encore signalée : point restant à vérifier", () => {
    const after = letterOf(["Chez Talan, j'ai conçu une couche RAG."]);
    const done = completeReview(startReview([issues[2]], "correcting"), after, [issues[2]]);
    expect(done.changes[0].outcome).toBe("unchanged");
    expect(reviewLabel(done)).toBe("Relecture : 1 point restant à vérifier");
  });

  test("aucun problème : étape « aucune affirmation sans source »", () => {
    expect(reviewLabel(startReview([], "correcting"))).toBe("Relecture : aucune affirmation sans source");
  });
});
