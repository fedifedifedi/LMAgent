/**
 * Règles de preuve envoyées dans chaque message à l'agent Cominty (lettre, correction, extraction du CV, résumé).
 * Au test réel, l'agent a suivi le message plutôt que ses instructions, et a glissé de petites inférences
 * (« deuxième année de master », « maîtriser le cycle complet ») : les règles sont donc répétées ici, explicitement.
 */
export const EVIDENCE_RULES = `Règles de preuve (obligatoires) :
- N'écris que ce qui est écrit dans la source (profil validé, CV, réponses du candidat). Ne déduis jamais ce qui n'est pas écrit : ni année d'études ni niveau (« deuxième année », « dernière année », « senior »), ni durée ou nombre non écrits, ni degré de maîtrise (« maîtrise », « expert », « solide expérience », « cycle complet »).
- Une technique, un outil ou un résultat ne compte pour une expérience ou un projet que s'il est écrit dans le texte de CETTE expérience ou de CE projet (titre, réalisations, compétences associées). Le résumé et la liste générale de compétences ne prouvent rien pour une expérience précise.
- Ne transfère jamais une technique, un outil, un résultat ou un statut (déployé, en production, livré) d'une expérience ou d'un projet à un autre.
- Ne cite une source que pour ce qu'elle dit réellement : si une phrase combine deux expériences, chaque fait doit venir de la source citée.
- Ne reprends jamais un terme de l'offre (mission, technique, vocabulaire de l'annonce) pour décrire une expérience ou un projet s'il n'est pas écrit dans son texte.
- Garde le verbe et le statut du CV pour chaque expérience : « intégration » ne devient pas « conçu », « utilisé » ne devient ni « garanti » ni « opérationnel », « livré prêt à l'emploi » ne devient pas « livré à l'équipe ».
- En cas de doute, retire l'affirmation plutôt que de la reformuler.`;
