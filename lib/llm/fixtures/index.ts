import profileDraft from "./profile_draft.json";

/** Réponses du provider mock, par nom de sortie (voir lib/schemas/llm-outputs.ts). */
export const MOCK_FIXTURES: Record<string, unknown> = {
  profile_draft: profileDraft,
};
