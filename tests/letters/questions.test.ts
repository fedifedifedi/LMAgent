import { describe, expect, test } from "bun:test";
import { checkEvidence, evidenceContext } from "@/lib/agent/evidence-checks";
import { checkLetter } from "@/lib/agent/letter-checks";
import { agentAnswersMessage, agentSourceIds } from "@/lib/agent/agent-reply";
import { answerSources, AnswersSchema, standardizeQuestions } from "@/lib/agent/questions";
import { OfferAnalysisSchema, type LetterContent } from "@/lib/agent/schemas";
import { MOCK_FIXTURES } from "@/lib/llm/fixtures";
import { cleanProfileInput } from "@/lib/profile/clean";
import { draftToFormValues, syncSkillsIntoGroups } from "@/lib/profile/form-values";
import { ProfileDraftSchema, ProfileSchema } from "@/lib/schemas/profile";

const requirements = [
  { name: "LangChain", kind: "hard", importance: "preferred" as const },
  { name: "Kubernetes", kind: "hard", importance: "required" as const },
  { name: "Docker", kind: "hard", importance: "required" as const },
  { name: "Anglais professionnel", kind: "language", importance: "preferred" as const },
];

describe("questions de l'agent (standardisées par le code)", () => {
  test("3 au plus, obligatoires d'abord, formulation et 4 boutons identiques", () => {
    const questions = standardizeQuestions(
      [{ prompt: "Tu connais LangChain ?" }, { prompt: "As-tu utilisé Kubernetes en production ?" }, { prompt: "Docker ?" }, { prompt: "Ton niveau en anglais professionnel ?" }],
      requirements,
    );
    expect(questions.map((q) => q.requirement)).toEqual(["Kubernetes", "Docker", "LangChain"]);
    expect(questions[0]).toEqual({
      prompt: "As-tu déjà utilisé Kubernetes ? Si oui, dans quel projet ou quelle expérience ?",
      options: ["Oui (je précise)", "Non", "Non, mais je souhaite l'apprendre", "Passer"],
      requirement: "Kubernetes",
    });
  });

  test("question en double ou sans exigence connue : dédoublonnée, formulation de l'agent gardée", () => {
    const questions = standardizeQuestions([{ prompt: "Docker ?" }, { prompt: "As-tu déjà utilisé Docker ?" }, { prompt: "Quelle est ta motivation ?" }], requirements);
    expect(questions.map((q) => q.prompt)).toEqual(["As-tu déjà utilisé Docker ? Si oui, dans quel projet ou quelle expérience ?", "Quelle est ta motivation ?"]);
  });

  test("« Oui » sans précision refusé ; « Non », « Passer », « apprendre » acceptés sans précision", () => {
    expect(AnswersSchema.safeParse([{ prompt: "q", requirement: "Docker", choice: "yes", detail: "  " }]).success).toBe(false);
    expect(AnswersSchema.safeParse([{ prompt: "q", requirement: "Docker", choice: "yes" }]).success).toBe(false);
    expect(AnswersSchema.safeParse([{ prompt: "q", choice: "no" }, { prompt: "r", choice: "skip" }, { prompt: "s", choice: "learn" }]).success).toBe(true);
    expect(AnswersSchema.safeParse(Array.from({ length: 4 }, () => ({ prompt: "q", choice: "skip" }))).success).toBe(false);
  });
});

describe("réponses du candidat comme sources", () => {
  const values = syncSkillsIntoGroups(draftToFormValues(ProfileDraftSchema.parse(MOCK_FIXTURES.profile_draft))).values;
  values.availability = { ...values.availability, contractTypes: ["pfe-internship"] };
  const profile = ProfileSchema.parse(cleanProfileInput(values));
  const answers = AnswersSchema.parse([
    { prompt: "q1", requirement: "Docker", choice: "yes", detail: "Conteneurisation de l'API dans le projet Assistant de révision RAG" },
    { prompt: "q2", requirement: "Kubernetes", choice: "no" },
    { prompt: "q3", requirement: "LangChain", choice: "learn" },
  ]);
  const analysis = OfferAnalysisSchema.parse(MOCK_FIXTURES.offer_analysis);
  const letterOf = (texts: Array<[string, string[]]>): LetterContent => ({
    language: "fr",
    subject: "Candidature",
    salutation: "Bonjour Sarah Lemoine,",
    paragraphs: [{ sentences: texts.map(([text, sourceIds]) => ({ text, sourceIds })) }],
    closing: "Cordialement.",
  });

  test("chaque « Oui » devient une source citable « Réponse du candidat » ; le message à l'agent le dit", () => {
    expect(answerSources(answers)).toEqual([{ id: "candidate-answer-1", label: "Réponse du candidat : Docker", text: "Docker Conteneurisation de l'API dans le projet Assistant de révision RAG" }]);
    expect(agentSourceIds(profile, answers)).toContain("candidate-answer-1");
    const message = agentAnswersMessage(answers);
    expect(message).toContain("Docker : OUI");
    expect(message).toContain("source candidate-answer-1");
    expect(message).toContain("Kubernetes : NON → ne mentionne pas");
    expect(message).toContain("LangChain : NON, mais le candidat souhaite l'apprendre");
  });

  test("une réponse « Oui » est vérifiée comme le CV : verbe renforcé signalé", () => {
    const context = evidenceContext(profile, "Offre : Docker, Kubernetes.", answers);
    expect(checkEvidence(letterOf([["J'ai utilisé Docker pour la conteneurisation de l'API dans un projet RAG.", ["candidate-answer-1"]]]), context)).toEqual([]);
    const issues = checkEvidence(letterOf([["J'ai conçu toute l'infrastructure Docker du projet.", ["candidate-answer-1"]]]), context);
    expect(issues.some((i) => i.kind === "verb_inflated" && i.message.includes("Réponse du candidat : Docker"))).toBe(true);
  });

  test("« Non » : compétence interdite ; « souhaite l'apprendre » : permise seulement comme envie d'apprendre", () => {
    const match = {
      requirements: [
        { name: "Kubernetes", status: "missing" as const, sourceIds: [] },
        { name: "LangChain", status: "missing" as const, sourceIds: [] },
      ],
      arguments: [],
    };
    const check = (text: string) => checkLetter(letterOf([[text, []]]), { analysis, match, learning: ["LangChain"] }).filter((i) => i.kind === "claims_missing_skill").map((i) => i.message);
    expect(check("Je maîtrise Kubernetes.")).toEqual(["La lettre mentionne « Kubernetes », absent du profil."]);
    expect(check("Je souhaite apprendre LangChain pendant ce stage.")).toEqual([]);
    expect(check("J'utilise LangChain au quotidien.")).toEqual(["La lettre mentionne « LangChain », absent du profil."]);
  });
});
