import { analyzeOffer, critiqueLetter, matchProfile, writeLetter } from "@/lib/agent/letter-agent";
import { checkLetter, type LetterIssue } from "@/lib/agent/letter-checks";
import { CritiqueSchema, OfferAnalysisSchema, type Critique, type LetterContent, type OfferAnalysis, type ProfileMatch } from "@/lib/agent/schemas";
import { db } from "@/lib/db";
import type { Prisma } from "@/lib/generated/prisma/client";
import type { LlmStep } from "@/lib/generated/prisma/enums";
import { getProvider } from "@/lib/llm";
import type { LLMProvider, LLMUsage } from "@/lib/llm/types";
import { ProfileSchema, type Profile } from "@/lib/schemas/profile";

export const LETTER_STEPS = ["analyze", "match", "write", "critique", "rewrite"] as const;
export type LetterStep = (typeof LETTER_STEPS)[number];

const LLM_STEP: Record<LetterStep, LlmStep> = {
  analyze: "ANALYZE_OFFER",
  match: "MATCH_PROFILE",
  write: "WRITE_LETTER",
  critique: "CRITIQUE",
  rewrite: "REWRITE",
};

const FAST_STEPS = new Set<LetterStep>(["analyze", "match"]);

type LetterState ={ analysis: unknown; match: unknown; draft: unknown; critique: unknown; content: unknown };

/** Étape suivante, déduite des résultats déjà enregistrés (le pipeline reprend là où il s'est arrêté). */
export function nextStep(letter: LetterState): LetterStep | null {
  if (!letter.analysis) return "analyze";
  if (!letter.match) return "match";
  if (!letter.draft) return "write";
  if (!letter.critique) return "critique";
  if (!letter.content) return "rewrite";
  return null;
}

const asJson = (value: unknown) => value as Prisma.InputJsonValue;

/** Exécute une étape LLM et enregistre son coût dans LlmCall, qu'elle réussisse ou non. */
async function tracked<T>(letterId: string, step: LetterStep, provider: LLMProvider, run: (onUsage: (usage: LLMUsage) => void) => Promise<T>): Promise<T> {
  let usage: LLMUsage | undefined;
  const startedAt = performance.now();
  const record = (success: boolean, error?: string) =>
    db.llmCall.create({
      data: {
        letterId,
        step: LLM_STEP[step],
        provider: usage?.provider ?? provider.name,
        model: usage?.model ?? provider.model,
        inputTokens: usage?.inputTokens ?? 0,
        outputTokens: usage?.outputTokens ?? 0,
        cacheReadTokens: usage?.cacheReadTokens,
        attempts: usage?.attempts ?? 1,
        durationMs: usage?.durationMs ?? Math.round(performance.now() - startedAt),
        estimated: usage?.estimated ?? false,
        success,
        error,
      },
    });

  try {
    const result = await run((u) => (usage = u));
    await record(true);
    return result;
  } catch (error) {
    await record(false, error instanceof Error ? error.message : String(error));
    throw error;
  }
}

export type StepResult = { step: LetterStep; done: boolean };

/**
 * Exécute l'étape suivante de la lettre et enregistre son résultat. Après la critique, la lettre est finale si le
 * modèle et les vérifications du code n'ont rien à redire ; sinon une seule réécriture suit, puis on s'arrête
 * (les problèmes restants sont conservés dans `checks`).
 */
export async function runNextStep(letterId: string, options: { provider?: LLMProvider } = {}): Promise<StepResult | null> {
  const letter = await db.letter.findUnique({ where: { id: letterId }, include: { profile: true } });
  if (!letter) throw new Error(`Lettre introuvable : ${letterId}`);
  const step = nextStep(letter);
  if (!step) return null;

  // Analyse et correspondance sur LLM_MODEL_FAST (s'il est défini) ; rédaction, critique et réécriture sur LLM_MODEL.
  const provider = options.provider ?? getProvider(process.env, FAST_STEPS.has(step) ? "fast" : "default");
  const profile: Profile = ProfileSchema.parse(letter.profile.data);
  const analysis = letter.analysis ? OfferAnalysisSchema.parse(letter.analysis) : undefined;
  const match = letter.match as ProfileMatch | null;
  const draft = letter.draft as LetterContent | null;
  const call = { provider };

  await db.letter.update({ where: { id: letterId }, data: { status: "DRAFT", error: null } });

  try {
    switch (step) {
      case "analyze": {
        const result = await tracked(letterId, step, provider, (onUsage) => analyzeOffer(letter.offerText, { ...call, onUsage }));
        await db.letter.update({ where: { id: letterId }, data: { analysis: asJson(result), language: result.language } });
        break;
      }
      case "match": {
        const result = await tracked(letterId, step, provider, (onUsage) => matchProfile(analysis!, profile, { ...call, onUsage }));
        await db.letter.update({ where: { id: letterId }, data: { match: asJson(result) } });
        break;
      }
      case "write": {
        const result = await tracked(letterId, step, provider, (onUsage) => writeLetter({ analysis: analysis!, match: match!, profile }, { ...call, onUsage }));
        await db.letter.update({ where: { id: letterId }, data: { draft: asJson(result) } });
        break;
      }
      case "critique": {
        const critique = await tracked(letterId, step, provider, (onUsage) =>
          critiqueLetter({ letter: draft!, analysis: analysis!, match: match!, profile }, { ...call, onUsage }),
        );
        const checks = checkLetter(draft!, { analysis: analysis!, match: match! });
        const final = critique.verdict === "ok" && checks.length === 0;
        await db.letter.update({
          where: { id: letterId },
          data: {
            critique: asJson(critique),
            checks: asJson(checks),
            ...(final && { content: asJson(draft), status: "GENERATED" as const }),
          },
        });
        return { step, done: final };
      }
      case "rewrite": {
        const critique = CritiqueSchema.parse(letter.critique) as Critique;
        const previousChecks = (letter.checks as LetterIssue[] | null) ?? [];
        const result = await tracked(letterId, step, provider, (onUsage) =>
          writeLetter({ analysis: analysis!, match: match!, profile, feedback: { critique, checks: previousChecks, previous: draft! } }, { ...call, onUsage }),
        );
        const remaining = checkLetter(result, { analysis: analysis!, match: match! });
        await db.letter.update({ where: { id: letterId }, data: { content: asJson(result), checks: asJson(remaining), status: "GENERATED" } });
        return { step, done: true };
      }
    }
  } catch (error) {
    await db.letter.update({ where: { id: letterId }, data: { status: "FAILED", error: error instanceof Error ? error.message : String(error) } });
    throw error;
  }
  return { step, done: false };
}

export type { OfferAnalysis };
