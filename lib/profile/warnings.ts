import type { ProfileFormValues } from "@/lib/profile/form-values";
import { educationLabel, experienceLabel, projectLabel } from "@/lib/profile/labels";
import { isIncompleteDate } from "@/lib/schemas/profile";

export type ProfileWarning = {
  /** Chemin du champ concerné (nom react-hook-form), pour y amener l'utilisateur. */
  field: string;
  message: string;
};

const isEmpty = (value: unknown) => value === undefined || value === null || (typeof value === "number" && Number.isNaN(value)) || value === "";

/**
 * Champs importants vides ou imprécis : ils n'empêchent pas l'enregistrement mais appauvrissent la lettre.
 * Les erreurs bloquantes viennent de ProfileSchema, pas d'ici.
 */
export function profileWarnings(values: ProfileFormValues): ProfileWarning[] {
  const warnings: ProfileWarning[] = [];
  const { availability } = values;

  if (isEmpty(availability.durationMonths)) {
    warnings.push({ field: "availability.durationMonths", message: "Disponibilité : durée non renseignée." });
  }
  if (isEmpty(availability.startDate)) {
    warnings.push({ field: "availability.startDate", message: "Disponibilité : date de début non renseignée." });
  } else if (isIncompleteDate(availability.startDate)) {
    warnings.push({ field: "availability.startDate", message: `Disponibilité : à partir de ${availability.startDate}, mois à préciser ?` });
  }
  const mobility = availability.mobility ?? { countries: [], cities: [] };
  if ((mobility.countries ?? []).length === 0 && (mobility.cities ?? []).length === 0) {
    warnings.push({ field: "availability.mobility.cities", message: "Disponibilité : mobilité non renseignée (villes ou pays)." });
  }
  if (availability.acceptsRemote === undefined) {
    warnings.push({ field: "availability.acceptsRemote", message: "Disponibilité : télétravail non précisé." });
  }

  const dates = (base: string, label: string, start?: string | null, end?: string | null) => {
    if (isIncompleteDate(start)) warnings.push({ field: `${base}.start`, message: `${label} : début ${start}, mois à préciser ?` });
    if (isIncompleteDate(end)) warnings.push({ field: `${base}.end`, message: `${label} : fin ${end}, mois à préciser ?` });
  };

  values.experiences.forEach((e, i) => {
    const label = experienceLabel(e);
    if (e.achievements.length === 0) warnings.push({ field: `experiences.${i}.achievements`, message: `${label} : aucune réalisation.` });
    if (e.skills.length === 0) warnings.push({ field: `experiences.${i}.skills`, message: `${label} : aucune compétence.` });
    dates(`experiences.${i}`, label, e.start, e.end);
  });
  (values.projects ?? []).forEach((p, i) => {
    const label = projectLabel(p);
    if (p.achievements.length === 0) warnings.push({ field: `projects.${i}.achievements`, message: `${label} : aucune réalisation.` });
    if (p.skills.length === 0) warnings.push({ field: `projects.${i}.skills`, message: `${label} : aucune compétence.` });
    dates(`projects.${i}`, label, p.start, p.end);
  });
  values.education.forEach((e, i) => dates(`education.${i}`, educationLabel(e), e.start, e.end));

  if (values.skills.every((group) => group.items.length === 0)) {
    warnings.push({ field: "skills", message: "Aucune compétence dans le profil." });
  }
  return warnings;
}
