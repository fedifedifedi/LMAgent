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

