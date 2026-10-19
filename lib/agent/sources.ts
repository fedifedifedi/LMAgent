import { educationLabel, experienceLabel, projectLabel } from "@/lib/profile/labels";
import type { Profile } from "@/lib/schemas/profile";

/** Éléments du profil citables comme source d'une phrase de la lettre. */
export type SourceEntry = { id: string; label: string; content: unknown };

// Sources hors listes (préfixées pour ne jamais entrer en collision avec un id d'expérience ou de projet).
export const SPECIAL_SOURCES = {
  "profile-summary": "Résumé du profil",
  "profile-availability": "Disponibilités",
  "profile-skills": "Compétences du profil",
  "profile-languages": "Langues",
} as const;

/** Catalogue des sources d'un profil : id, libellé lisible (« Stage Talan, 2025 ») et contenu transmis au modèle. */
export function buildSourceCatalog(profile: Profile): SourceEntry[] {
  return [
    ...profile.experiences.map((e) => ({ id: e.id, label: experienceLabel(e), content: e })),
    ...profile.projects.map((p) => ({ id: p.id, label: projectLabel(p), content: p })),
    ...profile.education.map((e) => ({ id: e.id, label: educationLabel(e), content: e })),
    { id: "profile-summary", label: SPECIAL_SOURCES["profile-summary"], content: profile.summary },
    { id: "profile-availability", label: SPECIAL_SOURCES["profile-availability"], content: profile.availability },
    { id: "profile-skills", label: SPECIAL_SOURCES["profile-skills"], content: profile.skills },
    { id: "profile-languages", label: SPECIAL_SOURCES["profile-languages"], content: profile.languages },
  ];
}

export function sourceIds(catalog: SourceEntry[]): [string, ...string[]] {
  const ids = catalog.map((entry) => entry.id);
  return ids as [string, ...string[]];
}

/** Profil sérialisé pour les prompts : chaque élément avec son id de source. */
export function profileForPrompt(profile: Profile, catalog: SourceEntry[]) {
  return {
    candidate: { ...profile.identity, city: profile.contact.city },
    sources: catalog.map(({ id, content }) => ({ id, content })),
  };
}
