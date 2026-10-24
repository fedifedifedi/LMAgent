import { z } from "zod";

/**
 * Questions de l'agent sur les exigences que le CV ne prouve pas. L'agent les pose avec le mécanisme natif de Cominty ;
 * le code les standardise (3 au plus, obligatoires d'abord, même formulation, 4 boutons) et transforme chaque « Oui »
 * en source citable « Réponse du candidat » (candidate-answer-1 à -3), vérifiée comme un élément du CV.
 */

export const MAX_QUESTIONS = 3;

export const ANSWER_OPTIONS = {
  yes: "Oui (je précise)",
  no: "Non",
  learn: "Non, mais je souhaite l'apprendre",
  skip: "Passer",
} as const;
export type AnswerChoice = keyof typeof ANSWER_OPTIONS;

/** Question affichée : la formulation, les 4 boutons, et l'exigence de l'offre concernée. */
export type AgentQuestion = { prompt: string; options: string[]; requirement?: string };

type Requirement = { name: string; kind: string; importance: "required" | "preferred" };

const norm = (text: string) => text.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase();

/** Formulation standard : « As-tu déjà utilisé Kubernetes ? Si oui, dans quel projet ou quelle expérience ? ». */
export function standardPrompt(requirement: Requirement): string {
  if (isSkill(requirement)) return `As-tu déjà utilisé ${requirement.name} ? Si oui, dans quel projet ou quelle expérience ?`;
  // Langue, diplôme, expérience : pas un outil qu'on « utilise » (au test réel : « anglais professionnel »).
  return `L'offre demande « ${requirement.name} » : as-tu un élément que ton CV ne mentionne pas ? Si oui, lequel (certification, expérience) ?`;
}

/** Outil ou compétence technique (ou comportementale) : seule catégorie qu'on peut « souhaiter apprendre ». */
const isSkill = (requirement: Requirement) => requirement.kind === "hard" || requirement.kind === "soft";

/** Boutons d'une question : « souhaite l'apprendre » seulement pour une compétence, pas pour une langue ou un diplôme. */
export const optionsFor = (requirement?: Requirement) =>
  Object.entries(ANSWER_OPTIONS)
    .filter(([choice]) => choice !== "learn" || !requirement || isSkill(requirement))
    .map(([, label]) => label);

/**
 * Standardise les questions natives de l'agent : chaque question est rattachée à l'exigence qu'elle cite, reformulée,
 * dotée des 4 boutons ; les exigences obligatoires passent d'abord ; au plus 3. Une question qui ne cite aucune
 * exigence connue garde la formulation de l'agent (avec les mêmes boutons).
 */
export function standardizeQuestions(questions: Array<{ prompt: string }>, requirements: Requirement[] = []): AgentQuestion[] {
  const seen = new Set<string>();
  const standardized = questions.map((question) => {
    // L'exigence la plus longue citée par la question (« Kubernetes » plutôt que « K8s » si les deux existent).
    const requirement = [...requirements].sort((a, b) => b.name.length - a.name.length).find((r) => norm(question.prompt).includes(norm(r.name)));
    return requirement
      ? { prompt: standardPrompt(requirement), options: optionsFor(requirement), requirement: requirement.name, rank: requirement.importance === "required" ? 0 : 1 }
      : { prompt: question.prompt.trim(), options: optionsFor(), rank: 2 };
  });
  return standardized
    .filter((q) => {
      const key = q.requirement ?? q.prompt;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .sort((a, b) => a.rank - b.rank)
    .slice(0, MAX_QUESTIONS)
    .map((q) => (q.requirement ? { prompt: q.prompt, options: q.options, requirement: q.requirement } : { prompt: q.prompt, options: q.options }));
}

export const AnswerSchema = z
  .object({
    prompt: z.string().min(1).max(1000),
    requirement: z.string().max(200).optional(),
    choice: z.enum(["yes", "no", "learn", "skip"]),
    detail: z.string().trim().max(2000).optional(),
  })
  .refine((answer) => answer.choice !== "yes" || Boolean(answer.detail), { message: "Précise le projet ou l'expérience pour une réponse « Oui »." });
export const AnswersSchema = z.array(AnswerSchema).min(1).max(MAX_QUESTIONS);
export type CandidateAnswer = z.infer<typeof AnswerSchema>;

/** Id de source de la n-ième réponse « Oui » (1, 2, 3). */
export const answerSourceId = (index: number) => `candidate-answer-${index + 1}`;
export const ANSWER_SOURCE_IDS = Array.from({ length: MAX_QUESTIONS }, (_, i) => answerSourceId(i));

/** Sources citables tirées des réponses « Oui » : id, libellé « Réponse du candidat : X », texte vérifiable. */
export function answerSources(answers: CandidateAnswer[]): Array<{ id: string; label: string; text: string }> {
  return answers
    .filter((a) => a.choice === "yes" && a.detail)
    .map((a, index) => ({ id: answerSourceId(index), label: `Réponse du candidat : ${a.requirement ?? a.prompt}`, text: `${a.requirement ?? ""} ${a.detail}`.trim() }));
}

/** Exigences que la lettre ne doit pas présenter comme acquises (« Non », « Passer », « souhaite l'apprendre »). */
export const notAcquired = (answers: CandidateAnswer[]) => answers.filter((a) => a.choice !== "yes" && a.requirement).map((a) => a.requirement!);
/** Exigences qu'on peut citer seulement comme envie d'apprendre. */
export const toLearn = (answers: CandidateAnswer[]) => answers.filter((a) => a.choice === "learn" && a.requirement).map((a) => a.requirement!);

/**
 * Exigences connues pour rattacher les questions : celles de l'analyse, sinon la liste « gaps » de la réponse de l'agent
 * (traitées comme des compétences), lues dans le texte JSON de la réponse.
 */
export function requirementsFrom(json: unknown): Requirement[] {
  const reply = (json ?? {}) as { analysis?: { requirements?: unknown }; gaps?: unknown };
  const fromAnalysis = Array.isArray(reply.analysis?.requirements) ? (reply.analysis.requirements as Requirement[]) : [];
  const fromGaps = Array.isArray(reply.gaps)
    ? (reply.gaps as Array<{ requirement?: unknown; importance?: unknown }>)
        .filter((g) => typeof g.requirement === "string")
        .map((g) => ({ name: g.requirement as string, kind: "hard", importance: g.importance === "required" ? ("required" as const) : ("preferred" as const) }))
    : [];
  const known = new Set(fromAnalysis.map((r) => norm(r.name)));
  return [...fromAnalysis.filter((r) => typeof r?.name === "string"), ...fromGaps.filter((g) => !known.has(norm(g.name)))];
}

/** Réponse sans exigence (question restée telle que l'agent l'a posée) : exigence retrouvée dans le texte de la question. */
export function withRequirements(answers: CandidateAnswer[], requirements: Array<{ name: string }>): CandidateAnswer[] {
  const byLength = [...requirements].sort((a, b) => b.name.length - a.name.length);
  return answers.map((a) => (a.requirement ? a : { ...a, ...(byLength.find((r) => norm(a.prompt).includes(norm(r.name))) ? { requirement: byLength.find((r) => norm(a.prompt).includes(norm(r.name)))!.name } : {}) }));
}