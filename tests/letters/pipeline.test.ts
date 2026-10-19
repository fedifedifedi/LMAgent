import { describe, expect, test } from "bun:test";
import { checkLetter, letterWordCount, mentions } from "@/lib/agent/letter-checks";
import { letterSchema, OfferAnalysisSchema, matchSchema, type LetterContent } from "@/lib/agent/schemas";
import { buildSourceCatalog, sourceIds } from "@/lib/agent/sources";
import { LLMRateLimitError } from "@/lib/llm/errors";
import { MOCK_FIXTURES } from "@/lib/llm/fixtures";
import { sanitizeForAnthropic, sanitizeForGemini, toTargetJsonSchema } from "@/lib/llm/json-schema";
import { createMockProvider } from "@/lib/llm/providers/mock";
import type { CompletionRequest, LLMProvider } from "@/lib/llm/types";
import { cleanProfileInput } from "@/lib/profile/clean";
import { draftToFormValues, syncSkillsIntoGroups } from "@/lib/profile/form-values";
import { ProfileDraftSchema, ProfileSchema, type Profile } from "@/lib/schemas/profile";
import { setupTestDatabase } from "../helpers/test-db";

await setupTestDatabase();
const { db } = await import("@/lib/db");
const { runNextStep, nextStep } = await import("@/lib/letters/pipeline");
const { getLetterView } = await import("@/lib/letters/view");
const { createProfile } = await import("@/lib/repositories/profiles");

// Profil de test : le brouillon de la fixture mock (Camille), complété comme dans le formulaire.
const values = syncSkillsIntoGroups(draftToFormValues(ProfileDraftSchema.parse(MOCK_FIXTURES.profile_draft))).values;
values.availability = { ...values.availability, contractTypes: ["pfe-internship"], durationMonths: 6, startDate: "2027-02" };
const profile: Profile = ProfileSchema.parse(cleanProfileInput(values));
const catalogIds = sourceIds(buildSourceCatalog(profile));

function recordingMock(failOn?: string) {
  const requests: CompletionRequest[] = [];
  const inner = createMockProvider();
  const provider: LLMProvider = {
    ...inner,
    complete: async (request) => {
      requests.push(request);
      if (request.name === failOn) throw new LLMRateLimitError("gemini", 37, "Limite de requêtes Gemini atteinte (niveau gratuit probable). Réessaie dans 37 s.");
      return inner.complete(request);
    },
  };
  return { provider, requests };
}

async function newLetter() {
  const { id: profileId } = await createProfile(profile);
  const letter = await db.letter.create({ data: { profileId, offerText: "Offre de stage chez Ateliers Nova…".repeat(10) } });
  return letter.id;
}

describe("schémas de la lettre", () => {
  test("les sources sont limitées aux ids du profil, y compris dans le JSON Schema envoyé au modèle", () => {
    const schema = toTargetJsonSchema(letterSchema(catalogIds)) as never as { properties: { paragraphs: { items: { properties: { sentences: { items: { properties: { sourceIds: { items: { enum: string[] } } } } } } } } } };
    const enumIds = schema.properties.paragraphs.items.properties.sentences.items.properties.sourceIds.items.enum;
    expect(enumIds).toEqual(catalogIds);
    expect(JSON.stringify(sanitizeForGemini(schema))).toContain('"enum":["exp-acme-2025"');
    expect(JSON.stringify(sanitizeForAnthropic(schema as never))).toContain('"enum":["exp-acme-2025"');
    expect(letterSchema(catalogIds).safeParse({ ...MOCK_FIXTURES.letter_draft as object, paragraphs: [{ sentences: [{ text: "x", sourceIds: ["inventee"] }] }] }).success).toBe(false);
  });

  test("correspondance : une exigence absente ne peut pas avoir de source", () => {
    const result = matchSchema(catalogIds).safeParse({
      requirements: [{ name: "Docker", status: "missing", sourceIds: ["exp-acme-2025"] }],
      arguments: [{ point: "a", sourceIds: ["exp-acme-2025"] }, { point: "b", sourceIds: ["edu-insa"] }],
    });
    expect(result.success).toBe(false);
  });

  test("fixture d'analyse valide", () => {
    expect(OfferAnalysisSchema.safeParse(MOCK_FIXTURES.offer_analysis).success).toBe(true);
  });
});

describe("vérifications de la lettre par le code", () => {
  const analysis = OfferAnalysisSchema.parse(MOCK_FIXTURES.offer_analysis);
  const match = { requirements: [{ name: "Docker", status: "missing" as const, sourceIds: [] }], arguments: [] };
  const letter = (text: string, overrides: Partial<LetterContent> = {}): LetterContent => ({
    language: "fr",
    subject: "Candidature",
    salutation: "Bonjour Sarah Lemoine,",
    paragraphs: [{ sentences: [{ text, sourceIds: [] }] }],
    closing: "Cordialement.",
    ...overrides,
  });
  const words = (n: number) => Array.from({ length: n }, (_, i) => `mot${i}`).join(" ");

  test("longueur hors de 250 à 350 mots", () => {
    expect(checkLetter(letter(words(400)), { analysis, match }).map((i) => i.kind)).toEqual(["too_long"]);
    expect(checkLetter(letter(words(100)), { analysis, match }).map((i) => i.kind)).toEqual(["too_short"]);
    expect(checkLetter(letter(words(300)), { analysis, match })).toEqual([]);
  });

  test("compétence absente du profil revendiquée, langue et contact ignoré", () => {
    const issues = checkLetter(letter(`${words(290)} Je maîtrise docker en production.`, { language: "en", salutation: "Madame, Monsieur," }), { analysis, match });
    expect(issues.map((i) => i.kind)).toEqual(["wrong_language", "claims_missing_skill", "addressing"]);
  });

  test("mentions : mot entier, casse et accents gérés", () => {
    expect(mentions("Expérience avec Node.js et C++", "node.js")).toBe(true);
    expect(mentions("Dockerisation", "Docker")).toBe(false);
    expect(mentions("Équipe", "équipe")).toBe(true);
  });
});

describe("pipeline complet (mock)", () => {
  test("analyse → correspondance → rédaction → critique → réécriture, sources valides, tokens suivis", async () => {
    const letterId = await newLetter();
    const { provider, requests } = recordingMock();

    for (let i = 0; i < 6 && (await runNextStep(letterId, { provider })); i++);

    const view = await getLetterView(letterId);
    expect(view?.status).toBe("GENERATED");
    expect(view?.next).toBeNull();
    expect(view?.template).toBe("moderne"); // template par défaut
    expect(requests.map((r) => [r.name, r.reasoning])).toEqual([
      ["offer_analysis", "low"],
      ["profile_match", "medium"],
      ["letter_draft", "high"],
      ["letter_critique", "high"],
      ["letter_draft", "high"],
    ]);
    // La réécriture reçoit la version précédente et les problèmes relevés par la critique.
    expect(requests[4].turns[0].text).toContain("Rewrite it and fix these problems");
    expect(requests[4].turns[0].text).toContain("generic");

    const cited = view!.letter!.paragraphs.flatMap((p) => p.sentences.flatMap((s) => s.sourceIds));
    expect(cited.length).toBeGreaterThan(0);
    for (const id of cited) expect(catalogIds).toContain(id);
    expect(view!.sources["exp-acme-2025"]).toBe("Stage Acme Logiciels, 2025");

    expect(letterWordCount(view!.letter!)).toBeGreaterThanOrEqual(250);
    expect(view!.checks).toEqual([]);
    expect(view!.usage.map((u) => u.step)).toEqual(["ANALYZE_OFFER", "MATCH_PROFILE", "WRITE_LETTER", "CRITIQUE", "REWRITE"]);
    expect(view!.usage.every((u) => u.success && u.estimated)).toBe(true);
    expect(view!.header).toMatchObject({ senderName: "Camille Martin", recipientLines: ["À l'attention de Sarah Lemoine", "Ateliers Nova", "Lyon (hybride)"] });
    expect(view!.highlightTerms).toContain("React");
    expect(view!.highlightTerms).not.toContain("Docker");
  });

  test("429 pendant la correspondance : lettre en échec, appel enregistré, reprise depuis l'étape en échec", async () => {
    const letterId = await newLetter();
    const failing = recordingMock("profile_match");
    await runNextStep(letterId, { provider: failing.provider });
    await expect(runNextStep(letterId, { provider: failing.provider })).rejects.toBeInstanceOf(LLMRateLimitError);

    const failed = await db.letter.findUniqueOrThrow({ where: { id: letterId }, include: { llmCalls: true } });
    expect(failed.status).toBe("FAILED");
    expect(failed.error).toContain("Réessaie dans 37 s");
    expect(nextStep(failed)).toBe("match");
    expect(failed.llmCalls.map((c) => [c.step, c.success])).toEqual([
      ["ANALYZE_OFFER", true],
      ["MATCH_PROFILE", false],
    ]);

    const ok = recordingMock();
    for (let i = 0; i < 6 && (await runNextStep(letterId, { provider: ok.provider })); i++);
    expect(ok.requests[0].name).toBe("profile_match"); // l'analyse n'est pas repayée
    expect((await db.letter.findUniqueOrThrow({ where: { id: letterId } })).status).toBe("GENERATED");
  });

  test("quota du jour épuisé : message exact sur la lettre, reprise possible", async () => {
    const { runLetterStepAction } = await import("@/app/letters/actions");
    const { DAILY_QUOTA_LETTER_MESSAGE } = await import("@/lib/llm/errors");
    const letterId = await newLetter();
    const daily: LLMProvider = {
      ...createMockProvider(),
      complete: async () => {
        throw new LLMRateLimitError("gemini", undefined, "Quota gratuit Gemini du jour épuisé. Il se recharge demain matin.", { daily: true });
      },
    };
    // L'action utilise le provider configuré : on remplace temporairement le mock par un provider en quota épuisé.
    const llm = await import("@/lib/llm");
    const original = llm.getProvider;
    const { mock } = await import("bun:test");
    mock.module("@/lib/llm", () => ({ ...llm, getProvider: () => daily }));
    try {
      const result = await runLetterStepAction(letterId);
      expect("view" in result && result.error).toBe(DAILY_QUOTA_LETTER_MESSAGE);
      expect(DAILY_QUOTA_LETTER_MESSAGE).toBe(
        "Quota gratuit Gemini du jour épuisé. Il se recharge demain matin. Ta lettre est sauvegardée : clique sur Reprendre à ce moment-là.",
      );
      expect("view" in result && result.view.status).toBe("FAILED");
    } finally {
      mock.module("@/lib/llm", () => ({ ...llm, getProvider: original }));
    }
  });

  test("critique sans reproche et vérifications passées : pas de réécriture", async () => {
    const letterId = await newLetter();
    const fixtures = { ...MOCK_FIXTURES, letter_critique: { verdict: "ok", issues: [] } };
    const inner = createMockProvider(fixtures);
    const names: string[] = [];
    const provider: LLMProvider = { ...inner, complete: (r) => (names.push(r.name), inner.complete(r)) };
    for (let i = 0; i < 6 && (await runNextStep(letterId, { provider })); i++);

    expect(names).toEqual(["offer_analysis", "profile_match", "letter_draft", "letter_critique"]);
    const view = await getLetterView(letterId);
    expect(view?.status).toBe("GENERATED");
    expect(view?.usage.some((u) => u.step === "REWRITE")).toBe(false);
  });
});
