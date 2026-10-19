import { isIncompleteDate, type ProfileDraft } from "@/lib/schemas/profile";

export type DraftWarnings = {
  /** Dates réduites à l'année, à préciser ou confirmer dans le formulaire. */
  incompleteDates: string[];
  /** Le CV n'a pas de résumé propre : l'utilisateur l'écrira (pas de rédaction par le modèle à l'extraction). */
  missingSummary: boolean;
  /** Aucune disponibilité trouvée dans le CV (type de contrat, date de début...). */
  missingAvailability: boolean;
};

export function draftWarnings(draft: ProfileDraft): DraftWarnings {
  const incompleteDates: string[] = [];
  const check = (label: string, start?: string | null, end?: string | null) => {
    if (isIncompleteDate(start)) incompleteDates.push(`${label} : début ${start}`);
    if (isIncompleteDate(end)) incompleteDates.push(`${label} : fin ${end}`);
  };

  for (const e of draft.experiences) check([e.title, e.company].filter(Boolean).join(" — ") || "Expérience", e.start, e.end);
  for (const p of draft.projects) check(p.name ?? "Projet", p.start, p.end);
  for (const e of draft.education) check([e.degree, e.school].filter(Boolean).join(" — ") || "Formation", e.start, e.end);
  if (isIncompleteDate(draft.availability.startDate)) {
    incompleteDates.push(`Disponibilité : à partir de ${draft.availability.startDate}`);
  }

  const { availability } = draft;
  return {
    incompleteDates,
    missingSummary: !draft.summary,
    missingAvailability: availability.contractTypes.length === 0 && !availability.startDate,
  };
}
