import letterDraft from "./letter_draft.json";
import offerAnalysis from "./offer_analysis.json";
import profileDraft from "./profile_draft.json";
import profileMatch from "./profile_match.json";
import profileSummary from "./profile_summary.json";

/**
 * Réponses du provider mock, par nom de sortie. Dans les sorties qui citent des sources du profil, les marqueurs
 * "{{source:N}}" sont remplacés par le N-ième id autorisé par le schéma reçu (cf. providers/mock.ts).
 */
export const MOCK_FIXTURES: Record<string, unknown> = {
  profile_draft: profileDraft,
  offer_analysis: offerAnalysis,
  profile_match: profileMatch,
  letter_draft: letterDraft,
  profile_summary: profileSummary,
};
