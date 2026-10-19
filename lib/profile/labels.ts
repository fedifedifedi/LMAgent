import type { CONTRACT_TYPES, EXPERIENCE_TYPES, LANGUAGE_LEVELS } from "@/lib/schemas/profile";

export const EXPERIENCE_TYPE_LABELS: Record<(typeof EXPERIENCE_TYPES)[number], string> = {
  internship: "Stage",
  apprenticeship: "Alternance",
  cdi: "CDI",
  cdd: "CDD",
  freelance: "Mission freelance",
  "part-time": "Temps partiel",
  other: "Expérience",
};

export const CONTRACT_TYPE_LABELS: Record<(typeof CONTRACT_TYPES)[number], string> = {
  "pfe-internship": "Stage de fin d'études",
  internship: "Stage",
  apprenticeship: "Alternance",
  cdi: "CDI",
  cdd: "CDD",
  freelance: "Freelance",
  "part-time": "Temps partiel",
};

export const LANGUAGE_LEVEL_LABELS: Record<(typeof LANGUAGE_LEVELS)[number], string> = {
  native: "Langue maternelle",
  C2: "C2 · maîtrise",
  C1: "C1 · autonome",
  B2: "B2 · avancé",
  B1: "B1 · intermédiaire",
  A2: "A2 · élémentaire",
  A1: "A1 · débutant",
};

const year = (date?: string | null) => (date ? date.slice(0, 4) : undefined);

/** "2025", "2023 – 2025", "depuis 2024" ; vide si aucune date. */
export function periodLabel(start?: string | null, end?: string | null): string {
  const from = year(start);
  if (!from) return "";
  if (end === null) return `depuis ${from}`;
  const to = year(end);
  return to && to !== from ? `${from} – ${to}` : from;
}

const join = (...parts: Array<string | undefined>) => parts.filter(Boolean).join(", ");

/**
 * Libellés lisibles d'un élément du profil, affichés pour les sources de la lettre (« Stage Talan, 2025 ») :
 * jamais l'id brut côté utilisateur.
 */
export function experienceLabel(e: { type?: string; company?: string; title?: string; start?: string; end?: string | null }) {
  const kind = e.type && e.type in EXPERIENCE_TYPE_LABELS ? EXPERIENCE_TYPE_LABELS[e.type as keyof typeof EXPERIENCE_TYPE_LABELS] : undefined;
  const head = kind && e.company ? `${kind} ${e.company}` : e.company || e.title || "Expérience";
  return join(head, periodLabel(e.start, e.end));
}

export function projectLabel(p: { name?: string; start?: string; end?: string | null }) {
  return join(`Projet ${p.name || "sans nom"}`, periodLabel(p.start, p.end));
}

export function educationLabel(e: { degree?: string; school?: string; start?: string; end?: string | null }) {
  return join(e.degree || "Formation", e.school, periodLabel(e.start, e.end));
}
