/** Nom de fichier lisible : « Lettre - Poste - Entreprise.pdf » (caractères interdits sous Windows retirés). */
export function pdfFileName(jobTitle?: string, company?: string): string {
  const parts = ["Lettre", jobTitle, company]
    .filter((part): part is string => Boolean(part?.trim()))
    .map((part) => part.replace(/[\\/:*?"<>|]+/g, " ").replace(/\s+/g, " ").trim());
  return `${parts.join(" - ").slice(0, 120)}.pdf`;
}
