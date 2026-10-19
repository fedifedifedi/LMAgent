import type { DocumentKind } from "@/lib/generated/prisma/enums";

/**
 * - fact : source de faits citable dans la lettre.
 * - style : anciennes lettres, uniquement pour le ton, JAMAIS comme source de faits.
 * - company : pages de l'entreprise ciblée (rattachées à une Letter).
 */
export type DocumentRole = "fact" | "style" | "company";

export const DOCUMENT_ROLE: Record<DocumentKind, DocumentRole> = {
  PROJECT: "fact",
  INTERNSHIP_REPORT: "fact",
  RECOMMENDATION: "fact",
  PAST_LETTER: "style",
  COMPANY_PAGE: "company",
};

export function kindsForRoles(roles: readonly DocumentRole[]): DocumentKind[] {
  return (Object.keys(DOCUMENT_ROLE) as DocumentKind[]).filter((kind) => roles.includes(DOCUMENT_ROLE[kind]));
}
