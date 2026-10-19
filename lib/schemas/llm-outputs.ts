import { ProfileDraftSchema, ProfileTargetSchema } from "@/lib/schemas/profile";
import type { LLMOutput } from "@/lib/llm/types";

/**
 * Registre des sorties structurées demandées au LLM.
 * - schema : schéma cible strict, converti en JSON Schema pour le modèle ; ses erreurs déclenchent les relances.
 * - lenientSchema (facultatif) : appliqué à la réponse validée, et en dernier recours si toutes les tentatives échouent.
 * Le nom sert de clé aux fixtures du provider mock (lib/llm/fixtures/<name>.json).
 */
export const LLM_OUTPUTS = {
  profile_draft: {
    name: "profile_draft",
    schema: ProfileTargetSchema,
    lenientSchema: ProfileDraftSchema,
  },
} satisfies Record<string, LLMOutput>;
