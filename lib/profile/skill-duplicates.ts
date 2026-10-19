import { OTHER_SKILLS_CATEGORY, type ProfileFormValues } from "@/lib/profile/form-values";
import { normalizeSkill } from "@/lib/schemas/profile";

/** Mots d'une compétence, sans accents ni casse : « Recherche vectorielle (Qdrant) » → recherche, vectorielle, qdrant. */
export function skillTokens(skill: string): string[] {
  return skill
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .split(/[^a-z0-9+#.]+/)
    .map((token) => token.replace(/^\.+|\.+$/g, ""))
    .filter(Boolean);
}

export type SkillDuplicate = {
  /** Compétence courte, entièrement contenue dans la longue (ex. « Qdrant »). */
  short: string;
  /** Compétence longue (ex. « recherche vectorielle (Qdrant) »). */
  long: string;
};

/**
 * Quasi-doublons dans la liste globale : tous les mots d'une compétence se retrouvent dans une autre
 * (« Qdrant » / « recherche vectorielle (Qdrant) », « LoRA » / « fine-tuning (LoRA) »). Les doublons exacts
 * (casse et espaces ignorés) sont déjà fusionnés ailleurs ; ici on propose, l'utilisateur décide.
 */
export function findSkillDuplicates(values: Pick<ProfileFormValues, "skills">): SkillDuplicate[] {
  const all = [...new Set(values.skills.flatMap((group) => group.items))];
  const pairs: SkillDuplicate[] = [];
  for (const short of all) {
    const shortTokens = skillTokens(short);
    if (shortTokens.length === 0) continue;
    for (const long of all) {
      if (short === long || normalizeSkill(short) === normalizeSkill(long)) continue;
      const longTokens = skillTokens(long);
      if (longTokens.length > shortTokens.length && shortTokens.every((token) => longTokens.includes(token))) {
        pairs.push({ short, long });
      }
    }
  }
  return pairs;
}

const uniqueSkills = (items: string[]) => {
  const seen = new Set<string>();
  return items.filter((item) => {
    const key = normalizeSkill(item);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
};

/**
 * Remplace la compétence `from` par `to` partout (groupes, expériences, projets), sans créer de doublon.
 * Dans les groupes, une compétence n'est gardée qu'à un seul endroit, par ordre de priorité : un groupe thématique
 * qui contenait déjà `to`, puis un autre groupe thématique, puis « Autres compétences » (rempli automatiquement).
 * Un groupe vidé est retiré.
 */
export function mergeSkills(values: ProfileFormValues, from: string, to: string): ProfileFormValues {
  const isFrom = (item: string) => normalizeSkill(item) === normalizeSkill(from);
  const replace = (items: string[]) => uniqueSkills(items.map((item) => (isFrom(item) ? to : item)));

  const groups = values.skills.map((group) => ({ ...group, items: group.items.map((item) => (isFrom(item) ? to : item)) }));
  const priority = (index: number) => {
    const group = values.skills[index];
    if (group.category === OTHER_SKILLS_CATEGORY) return 2;
    return group.items.some((item) => normalizeSkill(item) === normalizeSkill(to)) ? 0 : 1;
  };
  const order = groups.map((_, index) => index).sort((a, b) => priority(a) - priority(b) || a - b);
  const seen = new Set<string>();
  for (const index of order) {
    groups[index].items = groups[index].items.filter((item) => {
      const key = normalizeSkill(item);
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  }
  const skills = groups.filter((group) => group.items.length > 0);

  return {
    ...values,
    skills,
    experiences: values.experiences.map((e) => ({ ...e, skills: replace(e.skills) })),
    projects: (values.projects ?? []).map((p) => ({ ...p, skills: replace(p.skills) })),
  };
}
