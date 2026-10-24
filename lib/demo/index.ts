import leaDubois from "@/scripts/demo/lea-dubois.json";

/**
 * Profil de démonstration FICTIF (Léa Dubois, adresse example.com, numéro de la tranche réservée à la fiction) et offre
 * de stage associée : bouton « Essayer avec un profil de démo » de l'accueil, captures et scripts (scripts/demo/).
 */
export const DEMO_PROFILE_NAME = "Léa Dubois (démo)";
export const DEMO_PROFILE = leaDubois;

/** Copie de scripts/demo/offer.txt (vérifiée par un test). */
export const DEMO_OFFER = `Stage de fin d'études — Data scientist (6 mois) — Hélio Prévisions, Bordeaux (hybride)
Début : février 2027. Contact : M. Julien Roche, responsable data.

Hélio Prévisions aide les collectivités à prévoir et piloter leur consommation d'énergie. L'équipe compte une vingtaine de personnes à Bordeaux.

Missions :
- construire et évaluer des modèles de prévision de consommation en Python ;
- fiabiliser les chaînes de données en SQL ;
- restituer les prévisions aux clients dans des tableaux de bord.

Profil : étudiant·e en dernière année de master en data science ; Python, SQL et séries temporelles indispensables ; Power BI apprécié ; Docker est un plus ; anglais professionnel.
`;

/** Bouton de démo affiché sauf si DEMO_ENABLED=0. */
export const demoEnabled = (env: Record<string, string | undefined> = process.env) => env.DEMO_ENABLED !== "0";
