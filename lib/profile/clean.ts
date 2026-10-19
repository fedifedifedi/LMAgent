/**
 * Valeurs de formulaire → entrée de ProfileSchema : un champ vide ("" ou nombre non saisi) devient absent,
 * pour que les champs facultatifs (téléphone, URL, durée...) ne déclenchent pas d'erreur de format.
 * Les chaînes vides sont aussi retirées des listes (réalisations, compétences).
 */
export function cleanProfileInput(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(cleanProfileInput).filter((item) => item !== undefined);
  }
  if (typeof value === "string") {
    const trimmed = value.trim();
    return trimmed === "" ? undefined : trimmed;
  }
  if (typeof value === "number") return Number.isNaN(value) ? undefined : value;
  if (value && typeof value === "object") {
    const result: Record<string, unknown> = {};
    for (const [key, item] of Object.entries(value)) {
      const cleaned = cleanProfileInput(item);
      if (cleaned !== undefined) result[key] = cleaned;
    }
    return result;
  }
  return value;
}
