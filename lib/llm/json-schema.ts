import { z } from "zod";

/**
 * JSON Schema envoyé au modèle. io "input" : on décrit ce que le modèle doit produire (l'entrée du schéma).
 * Le schéma cible ne doit contenir ni .catch() ni .transform(), sinon le JSON Schema devient permissif.
 */
export function toTargetJsonSchema(schema: z.ZodObject): Record<string, unknown> {
  const jsonSchema: Record<string, unknown> = z.toJSONSchema(schema, { io: "input", unrepresentable: "throw" });
  delete jsonSchema.$schema;
  return jsonSchema;
}

// Formats de chaîne acceptés par les sorties structurées d'Anthropic (doc API et SDK).
const ANTHROPIC_STRING_FORMATS = new Set([
  "date-time", "time", "date", "duration", "email", "hostname", "uri", "ipv4", "ipv6", "uuid",
]);

/**
 * Adapte un JSON Schema aux sorties structurées d'Anthropic (output_config.format). Mêmes règles que
 * transformJSONSchema du SDK (additionalProperties: false, formats et minItems limités, contraintes non
 * gérées reportées dans description), sauf qu'on GARDE enum et const : le SDK 0.135 les relègue dans
 * description alors que l'API les gère, et le modèle perdrait la contrainte.
 */
export function sanitizeForAnthropic(input: Record<string, unknown>): Record<string, unknown> {
  const schema = { ...input };
  const take = (key: string) => {
    const value = schema[key];
    delete schema[key];
    return value;
  };
  const result: Record<string, unknown> = {};

  const defs = take("$defs") as Record<string, Record<string, unknown>> | undefined;
  if (defs) result.$defs = Object.fromEntries(Object.entries(defs).map(([name, def]) => [name, sanitizeForAnthropic(def)]));
  const ref = take("$ref");
  if (ref !== undefined) return { ...result, $ref: ref };

  const type = take("type");
  const variants = (take("anyOf") ?? take("oneOf")) as Record<string, unknown>[] | undefined;
  const allOf = take("allOf") as Record<string, unknown>[] | undefined;
  if (variants) result.anyOf = variants.map(sanitizeForAnthropic);
  else if (allOf) result.allOf = allOf.map(sanitizeForAnthropic);
  if (type !== undefined) result.type = type;

  for (const key of ["description", "title", "enum", "const"]) {
    const value = take(key);
    if (value !== undefined) result[key] = value;
  }

  if (type === "object") {
    const properties = (take("properties") ?? {}) as Record<string, Record<string, unknown>>;
    result.properties = Object.fromEntries(Object.entries(properties).map(([name, sub]) => [name, sanitizeForAnthropic(sub)]));
    take("additionalProperties");
    result.additionalProperties = false;
    const required = take("required");
    if (required !== undefined) result.required = required;
  } else if (type === "string") {
    const format = schema.format;
    if (typeof format === "string" && ANTHROPIC_STRING_FORMATS.has(format)) result.format = take("format");
  } else if (type === "array") {
    const items = take("items") as Record<string, unknown> | undefined;
    if (items) result.items = sanitizeForAnthropic(items);
    if (schema.minItems === 0 || schema.minItems === 1) result.minItems = take("minItems");
  }

  // Contraintes restantes (pattern, minLength...) : indiquées au modèle, vérifiées par Zod.
  const rest = Object.entries(schema);
  if (rest.length > 0) {
    const hint = `{${rest.map(([key, value]) => `${key}: ${JSON.stringify(value)}`).join(", ")}}`;
    result.description = result.description ? `${result.description}\n\n${hint}` : hint;
  }
  return result;
}

// Mots-clés acceptés par responseJsonSchema (doc de GenerateContentConfig dans @google/genai).
const GEMINI_KEYWORDS = new Set([
  "$id", "$defs", "$ref", "$anchor", "type", "format", "title", "description", "enum", "items", "prefixItems",
  "minItems", "maxItems", "minimum", "maximum", "anyOf", "oneOf", "properties", "additionalProperties",
  "required", "propertyOrdering",
]);
// Clés dont la valeur est un dictionnaire nom -> sous-schéma.
const SCHEMA_MAPS = new Set(["properties", "$defs"]);

/** Retire récursivement les mots-clés non gérés par Gemini (pattern, minLength, const, default...). */
export function sanitizeForGemini(schema: unknown): unknown {
  if (Array.isArray(schema)) return schema.map(sanitizeForGemini);
  if (schema === null || typeof schema !== "object") return schema;

  const result: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(schema)) {
    if (!GEMINI_KEYWORDS.has(key)) continue;
    if (SCHEMA_MAPS.has(key) && value && typeof value === "object") {
      result[key] = Object.fromEntries(Object.entries(value).map(([name, sub]) => [name, sanitizeForGemini(sub)]));
    } else if (key === "enum" || key === "required" || key === "propertyOrdering") {
      result[key] = value;
    } else {
      result[key] = sanitizeForGemini(value);
    }
  }
  return result;
}
