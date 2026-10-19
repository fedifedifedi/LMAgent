import type { ProfileFormValues } from "@/lib/profile/form-values";
import { normalizeSkill } from "@/lib/schemas/profile";

function unique(items: string[], key: (item: string) => string): string[] {
  const seen = new Set<string>();
  return items.filter((item) => {
    const k = key(item);
    if (!item.trim() || seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}

/**
 * Fusionne un projet dans une expérience (le modèle a parfois dupliqué un stage en expérience ET en projet) :
 * réalisations et compétences ajoutées sans doublon (casse et espaces ignorés pour les compétences),
 * description reprise si l'expérience n'en a pas, puis projet retiré.
 */
export function mergeProjectIntoExperience(values: ProfileFormValues, projectIndex: number, experienceIndex: number): ProfileFormValues {
  const projects = values.projects ?? [];
  const project = projects[projectIndex];
  const experience = values.experiences[experienceIndex];
  if (!project || !experience) return values;

  const merged = {
    ...experience,
    achievements: unique([...experience.achievements, ...project.achievements], (a) => a.trim().toLowerCase()),
    skills: unique([...experience.skills, ...project.skills], normalizeSkill),
    summary: experience.summary?.trim() ? experience.summary : project.summary,
  };

  return {
    ...values,
    experiences: values.experiences.map((e, i) => (i === experienceIndex ? merged : e)),
    projects: projects.filter((_, i) => i !== projectIndex),
  };
}
