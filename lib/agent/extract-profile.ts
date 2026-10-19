import { generateObject, type GenerateObjectResult } from "@/lib/llm";
import type { Attachment, LLMProvider } from "@/lib/llm/types";
import { LLM_OUTPUTS } from "@/lib/schemas/llm-outputs";
import type { ProfileDraft } from "@/lib/schemas/profile";

export const EXTRACT_PROFILE_SYSTEM = `You extract a candidate profile from a CV into the given JSON schema.

Rules:
- Copy, do not write. Use only information explicitly present in the CV. If a field is not in the CV, leave it out. Never guess, infer or complete.
- Free text (titles, achievements, summary) stays in the language of the CV and as close to its wording as possible.
- Dates: exactly as precise as written. "2022" becomes "2022"; "mars 2023" becomes "2023-03". Never add a month or a day that is not written. A current position ("aujourd'hui", "present", "en cours") has end = null.
- summary: only if the CV contains its own summary, profile or tagline section; copy it. Otherwise leave summary out. Do not summarize the CV yourself.
- availability: only what the CV states (contract sought, duration, start date, mobility, remote work). Leave out anything not written.
- Language levels: use a CEFR level or "native" only when the CV states it or uses an unambiguous equivalent ("langue maternelle" = native, "bilingue" = C2). Otherwise leave the level out.
- experiences vs projects: an internship, apprenticeship, job, freelance mission or any position held in an organization goes in experiences ONLY, with its own achievements and skills (including the technologies the CV lists for it, even in a separate "projects" or "missions" block under that position). projects is only for personal, academic or open-source projects not tied to a position. Never list the same work in both.
- achievements: one entry per bullet or concrete result, wording preserved. skills: technologies or skills explicitly linked to that experience or project.
- skills (global list): group the skills listed in the CV by category, using the CV's own categories when it has them.
- ids: unique kebab-case identifiers derived from the content, e.g. exp-acme-2023, proj-chatbot, edu-insa.`;

/** Règle ajoutée quand le modèle lit le fichier lui-même (image, PDF scanné). */
export const NATIVE_READING_RULE = `- The CV is the attached file. If a part is illegible (blurry, cut off, too small, hidden), omit it rather than guess. Never reconstruct a partially readable word, date, name or number.`;

export type ExtractProfileResult = GenerateObjectResult<ProfileDraft>;

export type CvSourceContent = { text: string } | { file: Attachment };

/** Extraction d'un CV (texte, ou fichier lu nativement) vers un brouillon de profil. Recopie structurée : réflexion basse. */
export function extractProfile(
  source: CvSourceContent,
  options: { provider?: LLMProvider } = {},
): Promise<ExtractProfileResult> {
  const native = "file" in source;
  return generateObject({
    output: LLM_OUTPUTS.profile_draft,
    system: native ? `${EXTRACT_PROFILE_SYSTEM}\n${NATIVE_READING_RULE}` : EXTRACT_PROFILE_SYSTEM,
    prompt: native ? "Extract the profile from the attached CV." : `CV:\n\n${source.text}`,
    attachments: native ? [source.file] : undefined,
    reasoning: "low",
    provider: options.provider,
  });
}
