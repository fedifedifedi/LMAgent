import { experienceLabel } from "@/lib/profile/labels";
import { isIncompleteDate, normalizeSkill, type Profile } from "@/lib/schemas/profile";

export type CompletenessItem = {
  /** Champ du formulaire d'édition à ouvrir (ancre /profiles/[id]/edit#<field>). */
  field: string;
  message: string;
  weight: number;
};

export type Completeness = { score: number; missing: CompletenessItem[] };

/**
 * Score de complétude du profil (0 à 100) : critères pondérés selon leur utilité pour une lettre.
 * Ne pénalise que ce qui manque ; une date à l'année compte comme à préciser, pas comme fausse.
 */
export function profileCompleteness(profile: Profile): Completeness {
  const checks: Array<CompletenessItem & { ok: boolean }> = [];
  const add = (ok: boolean, weight: number, field: string, message: string) => checks.push({ ok, weight, field, message });
  const { contact, availability } = profile;

  add(profile.summary.trim().length >= 80, 8, "summary", "Résumé trop court (deux à quatre phrases).");
  add(!!contact.phone, 3, "contact.phone", "Téléphone.");
  add(!!contact.city, 3, "contact.city", "Ville.");
  add(!!(contact.linkedin || contact.github || contact.website), 3, "contact.linkedin", "Un lien (LinkedIn, GitHub ou site).");

  add(availability.durationMonths !== undefined, 5, "availability.durationMonths", "Durée recherchée.");
  add(!!availability.startDate, 5, "availability.startDate", "Date de début.");
  add(availability.mobility.cities.length + availability.mobility.countries.length > 0, 4, "availability.mobility.cities", "Mobilité (villes ou pays).");
  add(availability.acceptsRemote !== undefined, 2, "availability.acceptsRemote", "Télétravail accepté ou non.");

  add(profile.experiences.length > 0, 12, "experiences", "Au moins une expérience.");
  profile.experiences.forEach((e, i) => {
    const label = experienceLabel(e);
    add(e.achievements.length > 0, 6, `experiences.${i}.achievements`, `${label} : réalisations.`);
    add(e.skills.length > 0, 4, `experiences.${i}.skills`, `${label} : compétences.`);
    add(!isIncompleteDate(e.start) && !isIncompleteDate(e.end), 2, `experiences.${i}.start`, `${label} : mois de début et de fin.`);
  });

  add(profile.education.length > 0, 8, "education", "Au moins une formation.");
  add(profile.skills.reduce((n, g) => n + g.items.length, 0) >= 5, 6, "skills", "Au moins cinq compétences.");
  add(profile.languages.length > 0, 4, "languages", "Langues et niveaux.");

  const total = checks.reduce((sum, c) => sum + c.weight, 0);
  const earned = checks.filter((c) => c.ok).reduce((sum, c) => sum + c.weight, 0);
  return {
    score: total === 0 ? 100 : Math.round((earned / total) * 100),
    missing: checks.filter((c) => !c.ok).map(({ field, message, weight }) => ({ field, message, weight })).sort((a, b) => b.weight - a.weight),
  };
}

export type TimelineEntry = {
  id: string;
  kind: "experience" | "education" | "project";
  title: string;
  subtitle: string;
  start?: string;
  end?: string | null;
  current: boolean;
};

const sortKey = (date?: string | null) => (date ? date.padEnd(7, "-") : "");

/** Parcours daté (expériences, formations, projets), du plus récent au plus ancien ; les éléments en cours d'abord. */
export function profileTimeline(profile: Profile): TimelineEntry[] {
  const entries: TimelineEntry[] = [
    ...profile.experiences.map((e) => ({ id: e.id, kind: "experience" as const, title: e.title, subtitle: e.company, start: e.start, end: e.end, current: e.end === null })),
    ...profile.education.map((e) => ({ id: e.id, kind: "education" as const, title: e.degree, subtitle: e.school, start: e.start, end: e.end, current: e.end === null })),
    ...profile.projects
      .filter((p) => p.start)
      .map((p) => ({ id: p.id, kind: "project" as const, title: p.name, subtitle: p.role ?? "Projet", start: p.start, end: p.end ?? undefined, current: p.end === null })),
  ];
  return entries.sort((a, b) => {
    if (a.current !== b.current) return a.current ? -1 : 1;
    return sortKey(b.end ?? b.start).localeCompare(sortKey(a.end ?? a.start)) || sortKey(b.start).localeCompare(sortKey(a.start));
  });
}

/** Nombre d'expériences et de projets qui mobilisent chaque compétence (casse et espaces ignorés). */
export function skillUsage(profile: Profile): Map<string, number> {
  const usage = new Map<string, number>();
  for (const item of [...profile.experiences, ...profile.projects]) {
    for (const key of new Set(item.skills.map(normalizeSkill))) {
      usage.set(key, (usage.get(key) ?? 0) + 1);
    }
  }
  return usage;
}
