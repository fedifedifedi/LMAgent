import { z } from "zod";
import { EVIDENCE_RULES } from "@/lib/agent/evidence-rules";
import { extractJsonText } from "@/lib/cominty/json";
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
export function agentSourceIds(profile: Profile): [string, ...string[]] {
  return [...sourceIds(buildSourceCatalog(profile)), CANDIDATE_ANSWERS_SOURCE];
}

const normalize = (name: string) => name.trim().toLocaleLowerCase("fr");

const NeedsInputSchema = z.object({ status: z.literal("needs_input") });

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
  return {
    analysis: reply.analysis,
    match,
    letter: reply.letter,
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
Si une information indispensable manque : pose tes questions avec la fonction de questions native de Cominty et réponds exactement {"status":"needs_input"}.`;

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

export type CandidateAnswer = { prompt: string; answer: string };

/** Réponses du candidat aux questions natives de l'agent. */
export function agentAnswersMessage(answers: CandidateAnswer[]): string {
  const lines = answers.map((a) => `- Question : ${a.prompt}\n  Réponse : ${a.answer}`);
  return [
    `LMAgent — réponses du candidat (source ${CANDIDATE_ANSWERS_SOURCE}) :`,
    lines.join("\n"),
    `Réponds maintenant avec l'objet JSON complet (status "ready"), au format du premier message. Cite "${CANDIDATE_ANSWERS_SOURCE}" pour les faits tirés de ces réponses.`,
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
