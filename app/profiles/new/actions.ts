"use server";

import { redirect } from "next/navigation";
import { CvInputError } from "@/lib/cv/extract-text";
import { importCv, type CvInput } from "@/lib/cv/import";
import { LLMError, LLMValidationError } from "@/lib/llm";

export type ImportCvState = {
  error?: string;
  /** Texte collé, renvoyé pour ne pas le perdre en cas d'erreur. */
  text?: string;
};

function userMessage(error: unknown): string {
  if (error instanceof CvInputError) return error.message;
  if (error instanceof LLMValidationError) {
    return "Le modèle n'a pas produit de profil exploitable après plusieurs tentatives. Réessaie, ou colle le texte du CV.";
  }
  if (error instanceof LLMError) return error.message;
  console.error("Import du CV :", error);
  return "Erreur inattendue pendant l'analyse du CV.";
}

export async function importCvAction(_previous: ImportCvState, formData: FormData): Promise<ImportCvState> {
  const mode = formData.get("mode");
  const pasted = formData.get("text");
  let input: CvInput;

  if (mode === "file") {
    const file = formData.get("file");
    if (!(file instanceof File) || file.size === 0) return { error: "Choisis un fichier : PDF, JPG, PNG ou WebP." };
    input = { kind: "file", name: file.name, bytes: new Uint8Array(await file.arrayBuffer()) };
  } else {
    if (typeof pasted !== "string" || !pasted.trim()) return { error: "Colle le texte de ton CV." };
    input = { kind: "text", text: pasted };
  }

  let id: string;
  try {
    ({ id } = await importCv(input));
  } catch (error) {
    return { error: userMessage(error), text: typeof pasted === "string" ? pasted : undefined };
  }
  // Hors du try : redirect() fonctionne en levant une exception.
  redirect(`/profiles/import/${id}`);
}
