import { describe, expect, test } from "bun:test";
import { checkLetter, mentions } from "@/lib/agent/letter-checks";
import { letterSchema, OfferAnalysisSchema, matchSchema, type LetterContent } from "@/lib/agent/schemas";
import { buildSourceCatalog, sourceIds } from "@/lib/agent/sources";
import { MOCK_FIXTURES } from "@/lib/llm/fixtures";
import { toTargetJsonSchema } from "@/lib/llm/json-schema";
import { cleanProfileInput } from "@/lib/profile/clean";
import { draftToFormValues, syncSkillsIntoGroups } from "@/lib/profile/form-values";
import { ProfileDraftSchema, ProfileSchema, type Profile } from "@/lib/schemas/profile";

// Profil de test : le brouillon de la fixture mock (Camille), complété comme dans le formulaire.
const values = syncSkillsIntoGroups(draftToFormValues(ProfileDraftSchema.parse(MOCK_FIXTURES.profile_draft))).values;
values.availability = { ...values.availability, contractTypes: ["pfe-internship"], durationMonths: 6, startDate: "2027-02" };
const profile: Profile = ProfileSchema.parse(cleanProfileInput(values));
const catalogIds = sourceIds(buildSourceCatalog(profile));

describe("schémas de la lettre", () => {
  test("les sources sont limitées aux ids du profil, y compris dans le JSON Schema", () => {
    const schema = toTargetJsonSchema(letterSchema(catalogIds)) as never as { properties: { paragraphs: { items: { properties: { sentences: { items: { properties: { sourceIds: { items: { enum: string[] } } } } } } } } } };
    const enumIds = schema.properties.paragraphs.items.properties.sentences.items.properties.sourceIds.items.enum;
    expect(enumIds).toEqual(catalogIds);
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
