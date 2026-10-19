import { generateObject, type GenerateObjectResult } from "@/lib/llm";
import type { LLMProvider } from "@/lib/llm/types";
import { LLM_OUTPUTS } from "@/lib/schemas/llm-outputs";
import type { ProfileDraft } from "@/lib/schemas/profile";

export const EXTRACT_PROFILE_SYSTEM = `You extract a candidate profile from the text of a CV into the given JSON schema.

Rules:
- Copy, do not write. Use only information explicitly present in the CV. If a field is not in the CV, leave it out. Never guess, infer or complete.
- Free text (titles, achievements, summary) stays in the language of the CV and as close to its wording as possible.
- Dates: exactly as precise as written. "2022" becomes "2022"; "mars 2023" becomes "2023-03". Never add a month or a day that is not written. A current position ("aujourd'hui", "present", "en cours") has end = null.
- summary: only if the CV contains its own summary, profile or tagline section; copy it. Otherwise leave summary out. Do not summarize the CV yourself.
- availability: only what the CV states (contract sought, duration, start date, mobility, remote work). Leave out anything not written.
- Language levels: use a CEFR level or "native" only when the CV states it or uses an unambiguous equivalent ("langue maternelle" = native, "bilingue" = C2). Otherwise leave the level out.
- achievements: one entry per bullet or concrete result, wording preserved. skills: technologies or skills explicitly linked to that experience or project.
- skills (global list): group the skills listed in the CV by category, using the CV's own categories when it has them.
- ids: unique kebab-case identifiers derived from the content, e.g. exp-acme-2023, proj-chatbot, edu-insa.`;

export type ExtractProfileResult = GenerateObjectResult<ProfileDraft>;

/** Extraction d'un CV vers un brouillon de profil (recopie structurée : réflexion basse). */
export function extractProfile(cvText: string, options: { provider?: LLMProvider } = {}): Promise<ExtractProfileResult> {
  return generateObject({
    output: LLM_OUTPUTS.profile_draft,
    system: EXTRACT_PROFILE_SYSTEM,
    prompt: `CV:\n\n${cvText}`,
    reasoning: "low",
    provider: options.provider,
  });
}
