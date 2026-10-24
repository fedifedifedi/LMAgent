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
  const ask = requirement.kind === "hard" ? `As-tu déjà utilisé ${requirement.name} ?` : `As-tu une expérience en lien avec « ${requirement.name} » ?`;
  return `${ask} Si oui, dans quel projet ou quelle expérience ?`;
}

/**
 * Standardise les questions natives de l'agent : chaque question est rattachée à l'exigence qu'elle cite, reformulée,
 * dotée des 4 boutons ; les exigences obligatoires passent d'abord ; au plus 3. Une question qui ne cite aucune
 * exigence connue garde la formulation de l'agent (avec les mêmes boutons).
 */
export function standardizeQuestions(questions: Array<{ prompt: string }>, requirements: Requirement[] = []): AgentQuestion[] {
  const options = Object.values(ANSWER_OPTIONS);
  const seen = new Set<string>();
  const standardized = questions.map((question) => {
    // L'exigence la plus longue citée par la question (« Kubernetes » plutôt que « K8s » si les deux existent).
    const requirement = [...requirements].sort((a, b) => b.name.length - a.name.length).find((r) => norm(question.prompt).includes(norm(r.name)));
    return requirement
      ? { prompt: standardPrompt(requirement), options, requirement: requirement.name, rank: requirement.importance === "required" ? 0 : 1 }
      : { prompt: question.prompt.trim(), options, rank: 2 };
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
