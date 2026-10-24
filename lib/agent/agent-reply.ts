import { z } from "zod";
import { EVIDENCE_RULES } from "@/lib/agent/evidence-rules";
import { extractJsonText } from "@/lib/cominty/json";
import { normalizeLetterText } from "@/lib/letters/text";
import { answerSources, type CandidateAnswer } from "@/lib/agent/questions";
import { letterWordCount } from "@/lib/agent/letter-checks";
import { letterSchema, OfferAnalysisSchema, type LetterContent, type OfferAnalysis, type ProfileMatch } from "@/lib/agent/schemas";
import { buildSourceCatalog, sourceIds } from "@/lib/agent/sources";
import type { Profile } from "@/lib/schemas/profile";

/**
 * Réponse de l'agent Cominty en « LMAgent mode » (section ajoutée à ses instructions) : soit il attend des réponses
 * ({"status":"needs_input"} + questions natives), soit il rend l'analyse, le score, la lettre et les ajustements du CV.
 */

/** Faits donnés par le candidat en réponse aux questions de l'agent. */
export const CANDIDATE_ANSWERS_SOURCE = "candidate-answers";
export const CANDIDATE_ANSWERS_LABEL = "Tes réponses à l'agent";

/** Ids citables par l'agent : catalogue du profil + réponses du candidat. */
/** answers : réponses « Oui » déjà données dans la conversation (sources candidate-answer-N). */
export function agentSourceIds(profile: Profile, answers: CandidateAnswer[] = []): [string, ...string[]] {
  return [...sourceIds(buildSourceCatalog(profile)), ...answerSources(answers).map((s) => s.id), CANDIDATE_ANSWERS_SOURCE];
}

const normalize = (name: string) => name.trim().toLocaleLowerCase("fr");

/** En attente de réponses : l'analyse et les manques peuvent accompagner les questions (affichés pendant l'attente). */
const NeedsInputSchema = z.object({ status: z.literal("needs_input") }).passthrough();

export function agentReplySchema(ids: [string, ...string[]]) {
  return z.union([NeedsInputSchema, readyReplySchema(ids)]);
}

/** Réponse complète ; validée seule (et non via l'union) pour que les erreurs renvoyées à l'agent restent précises. */
export function readyReplySchema(ids: [string, ...string[]]) {
  const source = z.enum(ids);
  return z
    .object({
      status: z.literal("ready"),
      analysis: OfferAnalysisSchema,
      score: z.number().int().min(0).max(100),
      scoreReasons: z.array(z.string().min(1)).min(1).max(6),
      strengths: z.array(
        z.object({
          requirement: z.string().min(1),
          status: z.enum(["matched", "partial"]),
          evidence: z.string().min(1),
          sourceIds: z.array(source).min(1),
        }),
      ),
      gaps: z.array(z.object({ requirement: z.string().min(1), importance: z.enum(["required", "preferred"]).optional(), note: z.string().default("") })),
      letter: letterSchema(ids),
      cvAdjustments: z
        .array(z.object({ section: z.string().min(1), change: z.string().min(1), reason: z.string().min(1), sourceIds: z.array(source).default([]) }))
        .max(8)
        .default([]),
    })
    .superRefine((reply, ctx) => {
      // Forces et manques reprennent les noms exacts des exigences de l'analyse (affichage ✓ et vérifications du code).
      const names = new Set(reply.analysis.requirements.map((r) => normalize(r.name)));
      for (const [key, items] of [["strengths", reply.strengths], ["gaps", reply.gaps]] as const) {
        items.forEach((item, index) => {
          if (!names.has(normalize(item.requirement))) {
            ctx.addIssue({ code: "custom", path: [key, index, "requirement"], message: `"${item.requirement}" must be exactly the name of an item of analysis.requirements` });
          }
        });
      }
    });
}

export type AgentReply = z.infer<ReturnType<typeof agentReplySchema>>;
export type ReadyReply = Extract<AgentReply, { status: "ready" }>;

export type AgentInsights = {
  score: number;
  scoreReasons: string[];
  cvAdjustments: ReadyReply["cvAdjustments"];
};

/** Lit le texte de l'agent : JSON (bloc de code toléré) validé par le schéma ; sinon les erreurs, pour la correction. */
export function parseAgentReply(content: string, ids: [string, ...string[]]): { ok: true; reply: AgentReply } | { ok: false; issues: string } {
  const text = extractJsonText(content);
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch (error) {
    return { ok: false, issues: `Invalid JSON: ${error instanceof Error ? error.message : String(error)}` };
  }
  const needsInput = (json as { status?: unknown } | null)?.status === "needs_input";
  if (!needsInput) json = dropEmptyOptionals(json);
  const parsed = needsInput ? NeedsInputSchema.safeParse(json) : readyReplySchema(ids).safeParse(json);
  if (parsed.success) return { ok: true, reply: parsed.data };
  // Zod saute le contrôle des noms quand d'autres erreurs existent : on l'ajoute, l'agent n'a qu'une correction.
  const nameIssues = needsInput ? [] : requirementNameIssues(json);
  return { ok: false, issues: [z.prettifyError(parsed.error), ...nameIssues].join("\n") };
}

const OPTIONAL_ANALYSIS_KEYS = ["company", "location", "contractType", "duration", "startDate"] as const;

/** "" ou null sur un champ facultatif de l'analyse = champ absent (l'agent remplit parfois le modèle au lieu d'omettre). */
function dropEmptyOptionals(json: unknown): unknown {
  const analysis = (json as { analysis?: Record<string, unknown> } | null)?.analysis;
  if (!analysis || typeof analysis !== "object") return json;
  const blank = (value: unknown) => value === null || (typeof value === "string" && value.trim() === "");
  for (const key of OPTIONAL_ANALYSIS_KEYS) if (blank(analysis[key])) delete analysis[key];
  const contact = analysis.contact as Record<string, unknown> | null | undefined;
  if (contact === null || (contact && blank(contact.name))) delete analysis.contact;
  else if (contact) for (const key of ["civility", "role"]) if (blank(contact[key])) delete contact[key];
  return json;
}

/** Noms des forces et manques absents de analysis.requirements, lus sur le JSON brut. */
function requirementNameIssues(json: unknown): string[] {
  const reply = json as { analysis?: { requirements?: Array<{ name?: unknown }> }; strengths?: Array<{ requirement?: unknown }>; gaps?: Array<{ requirement?: unknown }> };
  const names = new Set((reply?.analysis?.requirements ?? []).map((r) => (typeof r?.name === "string" ? normalize(r.name) : "")));
  if (names.size === 0) return [];
  const issues: string[] = [];
  for (const key of ["strengths", "gaps"] as const) {
    (reply[key] ?? []).forEach((item, index) => {
      if (typeof item?.requirement === "string" && !names.has(normalize(item.requirement))) {
        issues.push(`✖ "${item.requirement}" must be exactly the name of an item of analysis.requirements\n  → at ${key}[${index}].requirement`);
      }
    });
  }
  return issues;
}

/** Champs existants de la lettre (affichage, retouches, PDF et vérifications inchangés) à partir de la réponse prête. */
export function toLetterFields(reply: ReadyReply): { analysis: OfferAnalysis; match: ProfileMatch; letter: LetterContent; insights: AgentInsights } {
  const strengths = new Map(reply.strengths.map((s) => [normalize(s.requirement), s]));
  const match: ProfileMatch = {
    requirements: reply.analysis.requirements.map((requirement) => {
      const strength = strengths.get(normalize(requirement.name));
      return strength
        ? { name: requirement.name, status: strength.status, evidence: strength.evidence, sourceIds: strength.sourceIds }
        : { name: requirement.name, status: "missing" as const, evidence: "", sourceIds: [] };
    }),
    arguments: reply.strengths.map((s) => ({ point: s.evidence, sourceIds: s.sourceIds })),
  };
  // Espaces invisibles, retours à la ligne, parenthèses collées : nettoyés avant l'aperçu et le PDF.
  const clean = normalizeLetterText;
  const letter = {
    ...reply.letter,
    subject: clean(reply.letter.subject),
    salutation: clean(reply.letter.salutation),
    closing: clean(reply.letter.closing),
    paragraphs: reply.letter.paragraphs.map((p) => ({ sentences: p.sentences.map((s) => ({ ...s, text: clean(s.text) })) })),
  };
  return {
    analysis: reply.analysis,
    match,
    letter,
    insights: { score: reply.score, scoreReasons: reply.scoreReasons, cvAdjustments: reply.cvAdjustments },
  };
}

/**
 * Contrat de sortie répété dans chaque message : au test réel, l'agent a ignoré la section « LMAgent mode » de ses
 * instructions (clés snake_case, lettre en un seul bloc de texte), alors qu'il suit le format écrit dans le message.
 */
export const AGENT_OUTPUT_CONTRACT = `Format de réponse OBLIGATOIRE : un seul objet JSON, sans Markdown ni bloc de code, avec exactement ces clés (camelCase) :
{"status":"ready",
"analysis":{"language":"fr|en","jobTitle":"…","company":"…","location":"…","contractType":"…","duration":"…","startDate":"…","contact":{"name":"…","civility":"…","role":"…"},"missions":["…"],"requirements":[{"name":"…","kind":"hard|soft|language|education|experience","importance":"required|preferred"}],"companyFacts":["…"],"keywords":["…"]},
"score":0,
"scoreReasons":["3 à 5 raisons courtes"],
"strengths":[{"requirement":"nom exact d'un analysis.requirements[].name","status":"matched|partial","evidence":"preuve tirée du profil","sourceIds":["id autorisé"]}],
"gaps":[{"requirement":"nom exact d'un analysis.requirements[].name","importance":"required|preferred","note":"…"}],
"letter":{"language":"fr|en","subject":"objet","salutation":"formule d'appel","paragraphs":[{"sentences":[{"text":"une phrase","sourceIds":["id autorisé"]}]}],"closing":"formule de politesse seule"},
"cvAdjustments":[{"section":"…","change":"…","reason":"…","sourceIds":["id autorisé"]}]}
Règles :
- Omets une clé facultative (company, location, contractType, duration, startDate, contact, civility, role) plutôt que de l'inventer ; copie contact, companyFacts et dates tels qu'écrits dans l'offre.
- La lettre : 3 à 6 paragraphes, 250 à 300 mots en tout, découpée en phrases. PAS d'en-tête, de date, de lieu, de coordonnées ni de signature : l'application les ajoute. "closing" = la formule de politesse seule.
- Chaque phrase qui affirme un fait sur le candidat cite au moins un id autorisé ; une phrase sur l'entreprise ou l'offre n'en cite aucun. Jamais "profile-summary" comme preuve d'un projet précis.
- Si l'offre nomme un contact, la formule d'appel s'adresse à cette personne. Un manque n'est jamais présenté comme une compétence acquise.
- analysis, scoreReasons, strengths, gaps et cvAdjustments en français ; la lettre dans la langue de l'offre.
Questions au candidat (AVANT d'écrire la lettre) : compare chaque exigence de l'offre au profil. Pour chaque exigence que le profil ne prouve pas — d'abord les obligatoires (required), puis les appréciées (preferred) — pose une question avec la fonction de questions native de Cominty, au plus 3 en tout, une par exigence, en nommant l'exigence (« As-tu déjà utilisé Kubernetes ? Si oui, dans quel projet ou quelle expérience ? »). Réponds alors seulement {"status":"needs_input","analysis":{… comme ci-dessus},"gaps":[{"requirement":"nom exact","importance":"required|preferred"}]}, SANS lettre. Si le profil prouve toutes les exigences, écris directement l'objet "ready".`;

/** Premier message : en-tête « LMAgent », profil validé (seule source de faits), ids autorisés, offre, contrat de sortie. */
export function agentLetterMessage(profile: Profile, offerText: string): string {
  return [
    "LMAgent",
    `Profil validé du candidat (JSON, seule source de faits) :\n${JSON.stringify(profile)}`,
    `Ids de sources autorisés : ${agentSourceIds(profile).join(", ")}`,
    `Offre :\n${offerText}`,
    EVIDENCE_RULES,
    AGENT_OUTPUT_CONTRACT,
  ].join("\n\n");
}

/**
 * Réponses du candidat : chaque « Oui » devient une source à citer (candidate-answer-N) ; « Non », « Passer » et
 * « souhaite l'apprendre » interdisent de présenter la compétence comme acquise.
 */
export function agentAnswersMessage(answers: CandidateAnswer[]): string {
  const sources = answerSources(answers);
  let yes = 0;
  const lines = answers.map((a) => {
    const name = a.requirement ?? a.prompt;
    if (a.choice === "yes") return `- ${name} : OUI — « ${a.detail} » → source ${sources[yes++].id} (cite-la pour ce fait, avec ses mots, sans rien ajouter).`;
    if (a.choice === "learn") return `- ${name} : NON, mais le candidat souhaite l'apprendre → mentionne-la au plus comme une envie d'apprendre, jamais comme acquise.`;
    return `- ${name} : ${a.choice === "no" ? "NON" : "PAS DE RÉPONSE"} → ne mentionne pas cette compétence dans la lettre.`;
  });
  return [
    "LMAgent — réponses du candidat à tes questions :",
    lines.join("\n"),
    `Ids de sources autorisés : ${[...new Set([...sources.map((s) => s.id)])].join(", ") || "aucun nouveau"} (en plus de ceux du premier message).`,
    EVIDENCE_RULES,
    'Écris maintenant l\'objet JSON complet (status "ready"), au format du premier message. Ne pose plus de question.',
  ].join("\n\n");
}

/** Relecture critique : problèmes de preuve détectés par le code, renvoyés à l'agent (correction unique). */
export function agentEvidenceCorrectionMessage(problems: Array<{ message: string; sentence?: string }>, letter?: LetterContent): string {
  // Chaque phrase est montrée dans son paragraphe : au test réel, une phrase corrigée répétait la phrase voisine.
  const context = letter
    ? [...new Set(problems.map((p) => p.sentence).filter(Boolean))].map((sentence) => {
        const paragraph = letter.paragraphs.find((p) => p.sentences.some((s) => s.text === sentence));
        return `Phrase : « ${sentence} »\n  Son paragraphe : « ${paragraph?.sentences.map((s) => s.text).join(" ") ?? sentence} »`;
      })
    : [];
  const words = letter ? letterWordCount(letter) : undefined;
  return [
    "LMAgent — relecture : ta lettre contient des affirmations qui ne sont pas écrites dans le CV pour l'expérience citée.",
    `Problèmes :\n${problems.map((p) => `- ${p.message}`).join("\n")}`,
    ...(context.length ? [`Phrases concernées, avec leur paragraphe :\n${context.join("\n")}`] : []),
    "Corrige ces phrases : reprends les mots et les verbes du CV pour l'expérience citée, ou retire l'affirmation. Ne change rien d'autre.",
    "La phrase corrigée ne répète pas ce que disent déjà les phrases voisines du paragraphe (outils, résultats).",
    `${words !== undefined ? `La lettre fait ${words} mots. ` : ""}Elle doit rester entre 250 et 300 mots : si tu retires une affirmation, compense par un autre fait du profil, avec sa source.`,
    EVIDENCE_RULES,
    AGENT_OUTPUT_CONTRACT,
    "Renvoie l'objet JSON complet corrigé, et lui seul.",
  ].join("\n\n");
}

/** Relance unique quand le JSON ne respecte pas le format attendu. */
export function agentCorrectionMessage(issues: string): string {
  return [
    "LMAgent — ta réponse ne respecte pas le format JSON attendu.",
    `Erreurs :\n${issues}`,
    EVIDENCE_RULES,
    AGENT_OUTPUT_CONTRACT,
    "Renvoie l'objet JSON complet corrigé, et lui seul. N'invente aucune information.",
  ].join("\n\n");
}
