import { describe, expect, test } from "bun:test";
import { MOCK_FIXTURES } from "@/lib/llm/fixtures";
import { sanitizeForAnthropic, sanitizeForGemini, toTargetJsonSchema } from "@/lib/llm/json-schema";
import { LLM_OUTPUTS } from "@/lib/schemas/llm-outputs";

// Parcours libre d'un JSON Schema généré : le typer finement n'apporterait rien au test.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Schema = Record<string, any>;

function collectKeys(node: unknown, keys = new Set<string>()): Set<string> {
  if (Array.isArray(node)) node.forEach((item) => collectKeys(item, keys));
  else if (node && typeof node === "object") {
    for (const [key, value] of Object.entries(node)) {
      keys.add(key);
      collectKeys(value, keys);
    }
  }
  return keys;
}

describe("JSON Schema de profile_draft (schéma cible envoyé au modèle)", () => {
  const schema = toTargetJsonSchema(LLM_OUTPUTS.profile_draft.schema) as Schema;

  test("propriétés attendues à la racine", () => {
    expect(Object.keys(schema.properties).sort()).toEqual(
      ["availability", "contact", "education", "experiences", "identity", "interests", "languages", "projects", "skills", "summary"].sort(),
    );
  });

  test("enums présents : niveaux de langue, types de contrat, types d'expérience", () => {
    expect(schema.properties.languages.items.properties.level.enum).toEqual(["native", "C2", "C1", "B2", "B1", "A2", "A1"]);
    expect(schema.properties.availability.properties.contractTypes.items.enum).toEqual([
      "pfe-internship", "internship", "cdi", "cdd", "freelance", "apprenticeship", "part-time",
    ]);
    expect(schema.properties.experiences.items.properties.type.enum).toContain("part-time");
  });

  test("propriétés des éléments et champs obligatoires", () => {
    const experience = schema.properties.experiences.items;
    expect(Object.keys(experience.properties)).toEqual(
      expect.arrayContaining(["id", "title", "company", "type", "start", "end", "achievements", "skills"]),
    );
    expect(experience.required).toEqual(["title", "company"]);
    expect(schema.properties.languages.items.required).toEqual(["name"]);
  });

  test("format des dates décrit (pattern + description, Gemini ne gardant que la description)", () => {
    const start = schema.properties.experiences.items.properties.start;
    expect(start.pattern).toBeDefined();
    expect(start.description).toContain("YYYY-MM");
    const gemini = sanitizeForGemini(schema) as Schema;
    expect(gemini.properties.experiences.items.properties.start).toEqual({
      type: "string",
      description: "YYYY, or YYYY-MM only if the month is written in the source. Never add a month that is not written.",
    });
  });

  test("aucune valeur par défaut ni schéma vide (signe d'un .catch()/.default() dans le schéma cible)", () => {
    expect(collectKeys(schema).has("default")).toBe(false);
    const json = JSON.stringify(schema);
    expect(json).not.toContain(":{}");
  });
});

describe("toutes les sorties LLM", () => {
  for (const output of Object.values(LLM_OUTPUTS)) {
    test(`${output.name} : conversion JSON Schema, version Gemini sans mot-clé refusé`, () => {
      const schema = toTargetJsonSchema(output.schema);
      expect(schema.type).toBe("object");
      const keys = collectKeys(sanitizeForGemini(schema));
      for (const forbidden of ["pattern", "minLength", "maxLength", "const", "default", "$schema"]) {
        expect(keys.has(forbidden)).toBe(false);
      }
    });

    test(`${output.name} : version Anthropic, enums conservés et objets fermés`, () => {
      const schema = sanitizeForAnthropic(toTargetJsonSchema(output.schema));
      const keys = collectKeys(schema);
      for (const forbidden of ["pattern", "minLength", "maxLength", "default", "$schema"]) {
        expect(keys.has(forbidden)).toBe(false);
      }
      const enumsBefore = JSON.stringify(toTargetJsonSchema(output.schema)).match(/"enum":\[[^\]]*\]/g) ?? [];
      const enumsAfter = JSON.stringify(schema).match(/"enum":\[[^\]]*\]/g) ?? [];
      expect(enumsAfter).toEqual(enumsBefore);
      const objects = JSON.stringify(schema).match(/"type":"object"/g)?.length ?? 0;
      const closed = JSON.stringify(schema).match(/"additionalProperties":false/g)?.length ?? 0;
      expect(closed).toBe(objects);
    });

    test(`${output.name} : la fixture mock passe le schéma cible et le schéma tolérant`, () => {
      const fixture = MOCK_FIXTURES[output.name];
      expect(fixture).toBeDefined();
      const responses = Array.isArray(fixture) ? fixture : [fixture];
      const last = responses.at(-1);
      expect(output.schema.safeParse(last).success).toBe(true);
      if (output.lenientSchema) expect(output.lenientSchema.safeParse(last).success).toBe(true);
    });
  }
});
