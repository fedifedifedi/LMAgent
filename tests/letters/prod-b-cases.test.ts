import { describe, expect, test } from "bun:test";
import { agentEvidenceCorrectionMessage } from "@/lib/agent/agent-reply";
import { eventLabel } from "@/lib/agent/agent-labels";
import { checkEvidence, evidenceContext } from "@/lib/agent/evidence-checks";
import { checkLetter, repeatedTerms } from "@/lib/agent/letter-checks";
import { AnswersSchema, requirementsFrom, standardizeQuestions, toLearn, withRequirements } from "@/lib/agent/questions";
import { mergeTimelineStep, REVIEW_STEP_KEY } from "@/lib/agent/review";
import { OfferAnalysisSchema, type LetterContent } from "@/lib/agent/schemas";
import type { AgentClient } from "@/lib/cominty/mock-client";
import type { ComintyEvent } from "@/lib/cominty/schemas";
import type { StreamItem } from "@/lib/cominty/stream";
import { MOCK_FIXTURES } from "@/lib/llm/fixtures";
import { cleanProfileInput } from "@/lib/profile/clean";
import { draftToFormValues, syncSkillsIntoGroups } from "@/lib/profile/form-values";
import { ProfileDraftSchema, ProfileSchema } from "@/lib/schemas/profile";
import { setupTestDatabase } from "../helpers/test-db";

await setupTestDatabase();
const { db } = await import("@/lib/db");
const { followAgentRun, replyText, startAgentRun } = await import("@/lib/letters/agent-run");
const { createProfile } = await import("@/lib/repositories/profiles");

// Cas réels du test en production de B (offre « Nexora AI ») : analyse et questions telles que l'agent les a envoyées.
const ANALYSIS = {
  language: "fr",
  jobTitle: "Stagiaire PFE – AI Engineer",
  company: "Nexora AI",
  location: "Lyon (hybride)",
  missions: ["Développer des assistants LLM"],
  requirements: [
    { name: "Python et LLM (fine-tuning, RAG)", kind: "hard", importance: "required" },
    { name: "Kubernetes", kind: "hard", importance: "required" },
    { name: "Formation ingénieur IA ou data science", kind: "education", importance: "required" },
    { name: "LangChain", kind: "hard", importance: "preferred" },
    { name: "Anglais professionnel", kind: "language", importance: "preferred" },
  ],
  companyFacts: [],
  keywords: [],
};
const GAPS = [
  { requirement: "Kubernetes", importance: "required" },
  { requirement: "LangChain", importance: "preferred" },
  { requirement: "Anglais professionnel", importance: "preferred" },
];
const REAL_QUESTIONS = [
  { prompt: "As-tu déjà utilisé Kubernetes ? Si oui, dans quel projet ou quelle expérience (nom du projet, ce que tu as fait avec) ?", options: ["Oui, je l'ai utilisé", "Non, jamais"] },
  { prompt: "As-tu déjà utilisé LangChain ? Si oui, dans quel projet ou quelle expérience ?", options: ["Oui, je l'ai utilisé", "Non, jamais"] },
  { prompt: "L'offre mentionne « anglais professionnel » comme atout. Ton profil indique un niveau B1 — as-tu un élément plus récent à signaler (certification, expérience pro en anglais, cours intensif) ?", options: ["Mon niveau est toujours B1", "J'ai progressé, je peux préciser"] },
];
const REPLY_JSON = JSON.stringify({ status: "needs_input", analysis: ANALYSIS, gaps: GAPS });
const ev = (n: number, name: string, data: unknown): ComintyEvent => ({ id: `e${n}`, correlation_id: n, at: new Date(2026, 9, 24, 0, 58, n).toISOString(), status: "success", name, data }) as ComintyEvent;

describe("(1) étape de la frise avec le JSON brut de l'agent", () => {
  test("une mise à jour intermédiaire qui contient la réponse JSON n'est jamais affichée brute", () => {
    expect(eventLabel(ev(1, "intermediary_update", { message: REPLY_JSON }))).toBe("Préparation de la réponse");
    expect(eventLabel(ev(1, "intermediary_update", { message: "Lecture du profil" }))).toBe("Lecture du profil");
  });
});

describe("(2) (3) réponse dans une mise à jour intermédiaire, message final vide", () => {
  test("le texte de la réponse vient de la mise à jour quand le message final est vide", () => {
    expect(replyText({ content: "", events: [] }, REPLY_JSON)).toBe(REPLY_JSON);
    expect(replyText({ content: "", events: [{ name: "intermediary_update", data: { message: REPLY_JSON } }] })).toBe(REPLY_JSON);
    expect(replyText({ content: '{"status":"ready"}', events: [] }, REPLY_JSON)).toBe('{"status":"ready"}');
  });

  test("bout en bout : analyse enregistrée pendant l'attente, vraies questions standardisées", async () => {
    const values = syncSkillsIntoGroups(draftToFormValues(ProfileDraftSchema.parse(MOCK_FIXTURES.profile_draft))).values;
    values.availability = { ...values.availability, contractTypes: ["pfe-internship"] };
    const saved = await createProfile(ProfileSchema.parse(cleanProfileInput(values)));
    const letter = await db.letter.create({ data: { profileId: saved.id, offerText: "Stage AI Engineer chez Nexora AI. Kubernetes, LangChain." } });
    // Comme en production : la réponse JSON arrive dans un événement intermediary_update, le message final est vide.
    const client: AgentClient = {
      agentId: "prod-like",
      startChat: async () => ({ threadId: `t-${crypto.randomUUID()}`, messageId: `m-${crypto.randomUUID()}` }),
      sendMessage: async () => ({ threadId: "t", messageId: "m" }),
      stream: async function* (messageId): AsyncGenerator<StreamItem> {
        yield { type: "event", event: ev(1, "llm", { description: "Reasoning" }) };
        yield { type: "event", event: ev(2, "intermediary_update", { message: REPLY_JSON }) };
        yield { type: "message", message: { id: messageId, thread_id: "t", role: "assistant", content: "", status: "success", files: [], questions: REAL_QUESTIONS } };
      },
      cancel: async () => {
        throw new Error("non utilisé");
      },
    };
    const events: Array<{ type: string; step?: { label: string } }> = [];
    await followAgentRun(await startAgentRun(letter.id, client), client, (e) => events.push(e as never));
    expect(events.some((e) => e.step?.label.startsWith("{"))).toBe(false);

    const after = await db.letter.findUniqueOrThrow({ where: { id: letter.id }, include: { agentRuns: true } });
    expect(after.status).toBe("NEEDS_INPUT");
    expect((after.analysis as { company: string }).company).toBe("Nexora AI");
    const questions = after.agentRuns[0].questions as Array<{ prompt: string; options: string[]; requirement?: string }>;
    expect(questions.map((q) => q.requirement)).toEqual(["Kubernetes", "LangChain", "Anglais professionnel"]);
    expect(questions[0].prompt).toBe("As-tu déjà utilisé Kubernetes ? Si oui, dans quel projet ou quelle expérience ?");
    expect(questions[2].prompt).toContain("« Anglais professionnel »");
    expect(questions[2].options).not.toContain("Non, mais je souhaite l'apprendre");
    expect(questions[1].options).toContain("Non, mais je souhaite l'apprendre");
  });

  test("sans analyse lisible, les « gaps » de la réponse suffisent à rattacher les questions", () => {
    const questions = standardizeQuestions(REAL_QUESTIONS, requirementsFrom({ status: "needs_input", gaps: GAPS }));
    expect(questions.map((q) => q.requirement)).toEqual(["Kubernetes", "LangChain", "Anglais professionnel"]);
  });
});

describe("(4) libellé de la relecture figé en direct", () => {
  test("l'étape Relecture prend le libellé final ; un événement Cominty garde son premier libellé", () => {
    const running = { key: REVIEW_STEP_KEY, label: "Relecture : 2 points trouvés, correction demandée à l'agent…", status: "running", at: "a" };
    const done = { key: REVIEW_STEP_KEY, label: "Relecture : 2 affirmations sans source corrigées", status: "success", at: "b" };
    expect(mergeTimelineStep([running], done)).toEqual([{ ...done, at: "a" }]);
    const llm = { key: "r1:1", label: "Réflexion", status: "running", at: "a" };
    expect(mergeTimelineStep([llm], { ...llm, label: "Let me analyze…", status: "success", at: "b" })[0].label).toBe("Réflexion");
  });
});

const profile = ProfileSchema.parse({
  identity: { firstName: "Sami", lastName: "Exemple", headline: "Étudiant ingénieur IA" },
  contact: { email: "sami@example.com" },
  summary: "Étudiant ingénieur en IA.",
  availability: { contractTypes: ["pfe-internship"] },
  experiences: [
    {
      id: "exp-wind-2026", title: "Stagiaire DevOps & IA", company: "Wind Consulting", type: "internship", start: "2026-03", end: "2026-04",
      achievements: ["Plateforme ChatOps sécurisée pilotée depuis Telegram (StackStorm, Vault)", "Supervision avec Grafana"],
      skills: ["StackStorm", "Vault", "Grafana"],
    },
  ],
  projects: [],
  education: [{ id: "edu-iteam", degree: "Cycle ingénieur IA", school: "ITEAM University", start: "2025", end: "2027" }],
  skills: [{ category: "DevOps", items: ["StackStorm", "Vault", "Grafana"] }],
  languages: [{ name: "Anglais", level: "B1" }],
});
const letterOf = (texts: Array<[string, string[]]>): LetterContent => ({
  language: "fr",
  subject: "Candidature",
  salutation: "Bonjour,",
  paragraphs: [{ sentences: texts.map(([text, sourceIds]) => ({ text, sourceIds })) }],
  closing: "Cordialement.",
});

describe("(5) faux positif « opérationnelles »", () => {
  const context = evidenceContext(profile, "Offre : assistants LLM, Kubernetes, supervision.");
  test("« questions opérationnelles » n'est ni un statut ni un verbe renforcé", () => {
    const sentence = "Chez Wind Consulting, j'ai travaillé sur une plateforme ChatOps permettant aux ingénieurs de répondre à des questions opérationnelles depuis Telegram.";
    expect(checkEvidence(letterOf([[sentence, ["exp-wind-2026"]]]), context)).toEqual([]);
  });
  test("« supervision Grafana opérationnelle » reste un verbe renforcé", () => {
    const issues = checkEvidence(letterOf([["J'y ai mis en place une supervision Grafana opérationnelle.", ["exp-wind-2026"]]]), context);
    expect(issues.some((i) => i.kind === "verb_inflated")).toBe(true);
  });
});

describe("(6) exception « souhaite l'apprendre » ignorée", () => {
  test("réponse à une question non standardisée : l'exigence est retrouvée, la phrase d'apprentissage est permise", () => {
    const answers = withRequirements(AnswersSchema.parse([{ prompt: REAL_QUESTIONS[1].prompt, choice: "learn" }]), ANALYSIS.requirements);
    expect(answers[0].requirement).toBe("LangChain");
    const analysis = OfferAnalysisSchema.parse({ ...ANALYSIS, contact: undefined });
    const match = { requirements: [{ name: "LangChain", status: "missing" as const, sourceIds: [] }], arguments: [] };
    const sentence = "Je ne maîtrise pas encore LangChain, mais c'est un framework que je souhaite apprendre et intégrer à mes pratiques.";
    const issues = checkLetter(letterOf([[sentence, []]]), { analysis, match, learning: toLearn(answers) });
    expect(issues.filter((i) => i.kind === "claims_missing_skill")).toEqual([]);
  });
});

describe("(7) correction qui répète la phrase voisine et raccourcit la lettre", () => {
  const letter = letterOf([
    ["Chez Wind Consulting, j'ai déployé une plateforme ChatOps avec StackStorm, Vault et Grafana.", ["exp-wind-2026"]],
    ["J'y ai automatisé des opérations via StackStorm, sécurisé les secrets avec Vault et supervisé avec Grafana.", ["exp-wind-2026"]],
  ]);
  test("répétition détectée entre deux phrases consécutives", () => {
    const issues = repeatedTerms(letter);
    expect(issues).toHaveLength(1);
    expect(issues[0].message).toContain("StackStorm, Vault, Grafana");
  });
  test("le message de correction montre le paragraphe, interdit la répétition et rappelle la longueur", () => {
    const message = agentEvidenceCorrectionMessage([{ message: "« déployé » : statut absent", sentence: letter.paragraphs[0].sentences[0].text }], letter);
    expect(message).toContain("Son paragraphe : « Chez Wind Consulting");
    expect(message).toContain("ne répète pas ce que disent déjà les phrases voisines");
    expect(message).toContain("entre 250 et 300 mots");
    expect(message).toContain("compense par un autre fait du profil");
  });
});
