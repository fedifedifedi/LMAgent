import { z } from "zod";

// Sorties du pipeline de lettre. Schémas cibles stricts (sans .catch/.default/.transform), envoyés au modèle en JSON Schema.

export const OfferAnalysisSchema = z.object({
  language: z.enum(["fr", "en"]).describe("Language the job offer is written in"),
  jobTitle: z.string().min(1),
  company: z.string().min(1).optional().describe("Hiring company, only if named in the offer"),
  location: z.string().min(1).optional(),
  contractType: z.string().min(1).optional().describe("As written in the offer, e.g. Stage de fin d'études, CDI"),
  duration: z.string().min(1).optional().describe("As written, e.g. 6 mois"),
  startDate: z.string().min(1).optional().describe("As written in the offer"),
  contact: z
    .object({
      name: z.string().min(1).describe("Full name of the recruiter or contact person, exactly as written"),
      civility: z.string().min(1).optional().describe("Civility only if written: Mme, M., Mrs, Ms, Mr, Dr"),
      role: z.string().min(1).optional(),
    })
    .optional()
    .describe("Only if the offer names a recruiter or contact person. Never guess."),
  missions: z.array(z.string().min(1)).describe("Main missions, close to the offer wording"),
  requirements: z
    .array(
      z.object({
        name: z.string().min(1).describe("Skill, tool, language, degree or experience asked, short (e.g. Python, Docker, Anglais courant)"),
        kind: z.enum(["hard", "soft", "language", "education", "experience"]),
        importance: z.enum(["required", "preferred"]),
      }),
    )
    .min(1),
  companyFacts: z.array(z.string().min(1)).describe("Facts about the company stated in the offer (activity, products, values, size). Copied, never invented."),
  keywords: z.array(z.string().min(1)).describe("Key terms of the offer, for search"),
});
export type OfferAnalysis = z.infer<typeof OfferAnalysisSchema>;

export function matchSchema(ids: [string, ...string[]]) {
  const source = z.enum(ids);
  return z
    .object({
      requirements: z.array(
        z.object({
          name: z.string().min(1).describe("Requirement name, as in the analysis"),
          status: z.enum(["matched", "partial", "missing"]),
          evidence: z.string().optional().describe("What in the profile supports it, close to the profile wording. Empty when missing."),
          sourceIds: z.array(source).describe("Profile sources proving it. Empty when missing."),
        }),
      ),
      arguments: z
        .array(
          z.object({
            point: z.string().min(1).describe("One concrete argument linking the profile to the offer"),
            sourceIds: z.array(source).min(1),
          }),
        )
        .min(2)
        .max(5),
    })
    .superRefine((match, ctx) => {
      match.requirements.forEach((requirement, index) => {
        if (requirement.status === "missing" && requirement.sourceIds.length > 0) {
          ctx.addIssue({ code: "custom", path: ["requirements", index, "sourceIds"], message: "A missing requirement cannot have sources" });
        }
        if (requirement.status !== "missing" && requirement.sourceIds.length === 0) {
          ctx.addIssue({ code: "custom", path: ["requirements", index, "sourceIds"], message: "A matched or partial requirement needs at least one source" });
        }
      });
    });
}
export type ProfileMatch = z.infer<ReturnType<typeof matchSchema>>;

export function letterSchema(ids: [string, ...string[]]) {
  const source = z.enum(ids);
  return z.object({
    language: z.enum(["fr", "en"]),
    subject: z.string().min(1).describe("Subject line, e.g. Candidature au stage de fin d'études Data Scientist"),
    salutation: z.string().min(1).describe("Opening line, e.g. Madame, Monsieur, / Dear Ms Smith,"),
    paragraphs: z
      .array(
        z.object({
          sentences: z
            .array(
              z.object({
                text: z.string().min(1),
                sourceIds: z.array(source).describe("Profile sources of the facts this sentence states; empty for sentences with no fact about the candidate"),
              }),
            )
            .min(1),
        }),
      )
      .min(3)
      .max(6),
    closing: z.string().min(1).describe("Closing formula, one sentence"),
  });
}
export type LetterContent = z.infer<ReturnType<typeof letterSchema>>;

export const CRITIQUE_KINDS = [
  "unsupported_claim",
  "contradiction",
  "claims_missing_skill",
  "invented_company_fact",
  "too_long",
  "too_short",
  "wrong_language",
  "addressing",
  "generic",
  "tone",
  "other",
] as const;

export const CritiqueSchema = z.object({
  verdict: z.enum(["ok", "rewrite"]),
  issues: z.array(
    z.object({
      kind: z.enum(CRITIQUE_KINDS),
      quote: z.string().optional().describe("Excerpt of the letter concerned"),
      explanation: z.string().min(1),
      fix: z.string().min(1).describe("What to change"),
    }),
  ),
});
export type Critique = z.infer<typeof CritiqueSchema>;

export const ProfileSummarySchema = z.object({
  summary: z.string().min(1).describe("Two to four sentences, first person"),
});
