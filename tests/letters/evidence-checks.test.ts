import { describe, expect, test } from "bun:test";
import { checkEvidence, evidenceContext } from "@/lib/agent/evidence-checks";
import type { LetterContent } from "@/lib/agent/schemas";
import { companyLocation, normalizeLetterText } from "@/lib/letters/text";
import { ProfileSchema } from "@/lib/schemas/profile";

// Reconstitution FICTIVE du test réel (offre Nexora Labs) : mêmes types d'erreurs, données inventées.
const profile = ProfileSchema.parse({
  identity: { firstName: "Sami", lastName: "Exemple", headline: "Étudiant ingénieur IA" },
  contact: { email: "sami@example.com" },
  summary: "Étudiant ingénieur en IA, je travaille sur des assistants RAG et l'automatisation.",
  availability: { contractTypes: ["pfe-internship"], startDate: "2027" },
  experiences: [
    {
      id: "exp-wind-2026", title: "Stagiaire DevOps & IA", company: "Wind Consulting", type: "internship", start: "2026-03", end: "2026-04",
      achievements: ["Plateforme ChatOps sécurisée pilotée depuis Telegram, livrée à l'équipe", "Supervision avec Grafana et Prometheus", "Validation des entrées avec Zod"],
      skills: ["Docker", "Grafana", "Zod"],
    },
    {
      id: "exp-talan-2025", title: "Stagiaire IA", company: "Talan Tunisie", type: "internship", start: "2025-06", end: "2025-08",
      achievements: ["Intégration d'une couche RAG dans un assistant interne, livré prêt à l'emploi"],
      skills: ["Python", "RAG"],
    },
  ],
  projects: [{ id: "proj-docbot", name: "DocBot", summary: "Assistant RAG qui répond à partir des documents d'une PME.", achievements: ["Citation des sources"], skills: ["RAG"] }],
  education: [{ id: "edu-iteam", degree: "Cycle ingénieur IA", school: "ITEAM University", start: "2025", end: "2027" }],
  skills: [{ category: "IA", items: ["RAG", "Python"] }, { category: "DevOps", items: ["Docker", "Grafana", "Zod"] }],
  languages: [{ name: "Français", level: "C1" }],
});

const OFFER = `Stage IA — Nexora Labs, Lyon, France (hybride, 2 jours de télétravail).
Missions : découpage des documents et indexation ; conception d'une couche RAG ; supervision Grafana ; sorties validées avec Zod.`;

const context = { ...evidenceContext(profile, OFFER), analysis: { jobTitle: "Stage IA", company: "Nexora Labs" } };
const letterOf = (sentences: Array<[string, string[]]>): LetterContent => ({
  language: "fr",
  subject: "Candidature",
  salutation: "Bonjour,",
  paragraphs: [{ sentences: sentences.map(([text, sourceIds]) => ({ text, sourceIds })) }, { sentences: [{ text: "Merci.", sourceIds: [] }] }, { sentences: [{ text: "Cordialement.", sourceIds: [] }] }],
  closing: "Bien à vous.",
});

describe("dates écrites en toutes lettres", () => {
  test("« février 2027 » est prouvé par la disponibilité « 2027-02 » (démo Léa), pas par « 2027 » seul", () => {
    const offer = "Démarrage : février 2027.";
    const ctxOf = (startDate: string) => ({
      ...evidenceContext(ProfileSchema.parse({ ...profile, availability: { contractTypes: ["pfe-internship"], startDate } }), offer),
      analysis: { jobTitle: "Stage IA", company: "Nexora Labs" },
    });
    const sentence = letterOf([["Je suis disponible pour un stage de six mois à partir de février 2027.", ["profile-availability"]]]);
    expect(checkEvidence(sentence, ctxOf("2027-02"))).toEqual([]);
    expect(checkEvidence(sentence, ctxOf("2027")).map((i) => i.kind)).toContain("offer_term_unsourced");
  });
});

describe("relecture des preuves (cas Nexora Labs)", () => {
  test("terme repris de l'offre sans source dans le CV : « découpage des documents »", () => {
    const issues = checkEvidence(letterOf([["Chez Wind Consulting et sur DocBot, j'ai travaillé sur le découpage des documents.", ["exp-wind-2026", "proj-docbot"]]]), context);
    expect(issues.map((i) => i.kind)).toContain("offer_term_unsourced");
    expect(issues.find((i) => i.kind === "offer_term_unsourced")?.message).toContain("« découpage des documents »");
  });

  test("statut transféré : « livré à l'équipe » est le statut de Wind Consulting, pas de Talan", () => {
    const issues = checkEvidence(letterOf([["Chez Talan, j'ai livré à l'équipe un assistant RAG.", ["exp-talan-2025"]]]), context);
    const issue = issues.find((i) => i.kind === "status_transferred");
    expect(issue?.message).toContain("Wind Consulting");
    expect(issue?.message).toContain("Talan");
    expect(issue?.message).toContain("« livré à l'équipe »");
  });

  test("le bon statut de Talan (« livré prêt à l'emploi ») n'est pas signalé", () => {
    expect(checkEvidence(letterOf([["Chez Talan, j'ai intégré une couche RAG, livré prêt à l'emploi.", ["exp-talan-2025"]]]), context)).toEqual([]);
  });

  test("verbes renforcés : « conçu », « garanties », « opérationnelle »", () => {
    const issues = checkEvidence(
      letterOf([
        ["Chez Talan, j'ai conçu une couche RAG.", ["exp-talan-2025"]],
        ["Chez Wind Consulting, les entrées étaient garanties par Zod.", ["exp-wind-2026"]],
        ["J'y ai mis en place une supervision Grafana opérationnelle.", ["exp-wind-2026"]],
      ]),
      context,
    );
    const inflated = issues.filter((i) => i.kind === "verb_inflated").map((i) => i.message);
    expect(inflated.some((m) => m.includes("« conçu »"))).toBe(true);
    expect(inflated.some((m) => m.includes("« garanties »"))).toBe(true);
    expect(inflated.some((m) => m.includes("« opérationnelle »"))).toBe(true);
  });

  test("lettre fidèle au CV : aucun problème", () => {
    const issues = checkEvidence(
      letterOf([
        ["Chez Talan Tunisie, j'ai travaillé à l'intégration d'une couche RAG dans un assistant interne.", ["exp-talan-2025"]],
        ["Chez Wind Consulting, j'ai assuré la supervision avec Grafana et Prometheus et la validation des entrées avec Zod.", ["exp-wind-2026"]],
        ["La plateforme ChatOps a été livrée à l'équipe.", ["exp-wind-2026"]],
        ["Votre mission de découpage des documents m'intéresse particulièrement.", []],
      ]),
      context,
    );
    expect(issues).toEqual([]);
  });
});

describe("PDF : texte de l'agent et lieu de l'entreprise", () => {
  test("espaces manquants réparés : invisibles, retours à la ligne, parenthèse collée", () => {
    expect(normalizeLetterText("Candidature​au stage")).toBe("Candidature au stage");
    expect(normalizeLetterText("Candidature\nau stage")).toBe("Candidature au stage");
    expect(normalizeLetterText("Stage chez Nexora Labs(février 2027)")).toBe("Stage chez Nexora Labs (février 2027)");
    expect(normalizeLetterText("  Objet  : stage ")).toBe("Objet : stage");
  });

  test("lieu de l'entreprise : la ville et le pays, sans le mode de travail", () => {
    expect(companyLocation("Lyon, France (hybride, 2 jours de télétravail)")).toBe("Lyon, France");
    expect(companyLocation("Lyon, France — hybride")).toBe("Lyon, France");
    expect(companyLocation("Lyon, France, hybride 3 j/sem")).toBe("Lyon, France");
    expect(companyLocation("Bordeaux (hybride)")).toBe("Bordeaux");
    expect(companyLocation("Paris")).toBe("Paris");
  });
});
