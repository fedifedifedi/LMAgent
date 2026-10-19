/** "Wind Consulting 2025" → "wind-consulting-2025" (accents retirés, kebab-case). */
export function slugify(text: string): string {
  return text
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48)
    .replace(/-+$/g, "");
}

const ID_PATTERN = /^[a-z0-9-]+$/;

/** Id unique dans `taken` (qui est complété) : préfixe + parties lisibles, suffixe -2, -3... si besoin. */
export function uniqueId(prefix: string, parts: Array<string | null | undefined>, taken: Set<string>): string {
  const base = [prefix, slugify(parts.filter(Boolean).join(" "))].filter(Boolean).join("-") || prefix;
  let id = base;
  for (let n = 2; taken.has(id); n++) id = `${base}-${n}`;
  taken.add(id);
  return id;
}

/** Garde les ids valides et uniques, régénère les autres (absents, mal formés ou en double). */
export function ensureIds<T extends { id?: string }>(
  items: T[],
  prefix: string,
  parts: (item: T) => Array<string | null | undefined>,
  taken: Set<string>,
): Array<T & { id: string }> {
  return items.map((item) => {
    if (item.id && ID_PATTERN.test(item.id) && !taken.has(item.id)) {
      taken.add(item.id);
      return { ...item, id: item.id };
    }
    return { ...item, id: uniqueId(prefix, parts(item), taken) };
  });
}
