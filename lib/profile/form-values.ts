import type { z } from "zod";
import { ensureIds } from "@/lib/profile/ids";
import { normalizeSkill, type Profile, type ProfileDraft, ProfileSchema } from "@/lib/schemas/profile";

/** Valeurs du formulaire : l'entrée de ProfileSchema (nettoyée par cleanProfileInput avant validation). */
export type ProfileFormValues = z.input<typeof ProfileSchema>;
export type ExperienceValues = ProfileFormValues["experiences"][number];
export type ProjectValues = NonNullable<ProfileFormValues["projects"]>[number];

export const OTHER_SKILLS_CATEGORY = "Autres compétences";

/**
 * Brouillon issu du CV → valeurs complètes du formulaire. Rien n'est inventé : un champ absent reste vide
 * (et sera signalé par une erreur ou un avertissement). Seuls les ids manquants ou en double sont générés.
 */
export function draftToFormValues(draft: ProfileDraft): ProfileFormValues {
  const taken = new Set<string>();
  const { availability } = draft;

  return {
    identity: {
      firstName: draft.identity.firstName ?? "",
      lastName: draft.identity.lastName ?? "",
      headline: draft.identity.headline ?? "",
    },
    contact: {
      email: draft.contact.email ?? "",
      phone: draft.contact.phone ?? "",
      city: draft.contact.city ?? "",
      linkedin: draft.contact.linkedin ?? "",
      github: draft.contact.github ?? "",
      website: draft.contact.website ?? "",
    },
    summary: draft.summary ?? "",
    availability: {
      contractTypes: availability.contractTypes,
      durationMonths: availability.durationMonths,
      startDate: availability.startDate ?? "",
      mobility: { countries: availability.mobility.countries, cities: availability.mobility.cities },
      acceptsRemote: availability.acceptsRemote,
    },
    experiences: ensureIds(draft.experiences, "exp", (e) => [e.company ?? e.title, e.start?.slice(0, 4)], taken).map((e) => ({
      id: e.id,
      title: e.title ?? "",
      company: e.company ?? "",
      location: e.location ?? "",
      type: e.type as ExperienceValues["type"],
      start: e.start ?? "",
      // null = poste actuel ; absent = fin inconnue, à compléter.
      end: e.end === null ? null : (e.end ?? ""),
      summary: e.summary ?? "",
      achievements: e.achievements,
      skills: e.skills,
    })),
    projects: ensureIds(draft.projects, "proj", (p) => [p.name], taken).map((p) => ({
      id: p.id,
      name: p.name ?? "",
      role: p.role ?? "",
      url: p.url ?? "",
      start: p.start ?? "",
      end: p.end === null ? null : (p.end ?? ""),
      summary: p.summary ?? "",
      achievements: p.achievements,
      skills: p.skills,
    })),
    education: ensureIds(draft.education, "edu", (e) => [e.school ?? e.degree, e.start?.slice(0, 4)], taken).map((e) => ({
      id: e.id,
      degree: e.degree ?? "",
      school: e.school ?? "",
      location: e.location ?? "",
      start: e.start ?? "",
      end: e.end === null ? null : (e.end ?? ""),
      details: e.details,
    })),
    skills: draft.skills.map((group) => ({ category: group.category, items: group.items })),
    languages: draft.languages.map((language) => ({ name: language.name, level: language.level as ProfileFormValues["languages"][number]["level"] })),
    interests: draft.interests,
  };
}

/** Profil enregistré → valeurs du formulaire (édition). */
export function profileToFormValues(profile: Profile): ProfileFormValues {
  return {
    ...profile,
    contact: { phone: "", city: "", linkedin: "", github: "", website: "", ...profile.contact },
    availability: { ...profile.availability, startDate: profile.availability.startDate ?? "" },
    experiences: profile.experiences.map((e) => ({ location: "", summary: "", ...e })),
    projects: profile.projects.map((p) => ({ role: "", url: "", start: "", end: "", ...p })),
    education: profile.education.map((e) => ({ location: "", start: "", ...e, end: e.end })),
  };
}

/**
 * Ajoute à la liste globale (groupe « Autres compétences ») les compétences citées dans une expérience ou un
 * projet mais absentes des groupes : sans ça, ProfileSchema refuserait l'enregistrement.
 */
export function syncSkillsIntoGroups(values: ProfileFormValues): { values: ProfileFormValues; added: string[] } {
  const known = new Set(values.skills.flatMap((group) => group.items.map(normalizeSkill)));
  const added: string[] = [];
  for (const item of [...values.experiences, ...(values.projects ?? [])]) {
    for (const skill of item.skills) {
      const key = normalizeSkill(skill);
      if (skill.trim() && !known.has(key)) {
        known.add(key);
        added.push(skill.trim());
      }
    }
  }
  if (added.length === 0) return { values, added };

  const skills = [...values.skills];
  const index = skills.findIndex((group) => group.category === OTHER_SKILLS_CATEGORY);
  if (index === -1) skills.push({ category: OTHER_SKILLS_CATEGORY, items: added });
  else skills[index] = { ...skills[index], items: [...skills[index].items, ...added] };
  return { values: { ...values, skills }, added };
}
