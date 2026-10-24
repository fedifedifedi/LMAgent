"use server";

import { after } from "next/server";
import { z } from "zod";
import { isComintyMode, requestHasAccess } from "@/lib/cominty/agent-client";
import { ACCESS_REQUIRED_MESSAGE } from "@/lib/cominty/guard";
import { CvInputError } from "@/lib/cv/extract-text";
import type { CvInput } from "@/lib/cv/import";
import { getImportJob, startImportJob, type ImportJobState } from "@/lib/cv/import-job";

export type ImportCvState = {
  error?: string;
  /** Job d'extraction en arrière-plan, suivi par la page. */
  jobId?: string;
  /** Texte collé, renvoyé pour ne pas le perdre en cas d'erreur. */
  text?: string;
};

/**
 * Lance l'import en arrière-plan et répond tout de suite : la requête n'attend plus l'agent (un proxy comme celui de
 * Railway peut couper une requête longue, et le navigateur la renvoyer : c'était la cause des deux sessions).
 */
export async function importCvAction(_previous: ImportCvState, formData: FormData): Promise<ImportCvState> {
  const mode = formData.get("mode");
  const pasted = formData.get("text");
  const text = typeof pasted === "string" ? pasted : undefined;
  const requestKey = z.string().uuid().safeParse(formData.get("requestKey"));
  if (!requestKey.success) return { error: "Requête invalide : recharge la page.", text };
  let input: CvInput;

  if (mode === "file") {
    const file = formData.get("file");
    if (!(file instanceof File) || file.size === 0) return { error: "Choisis un fichier : PDF, JPG, PNG ou WebP." };
    input = { kind: "file", name: file.name, bytes: new Uint8Array(await file.arrayBuffer()) };
  } else {
    if (!text?.trim()) return { error: "Colle le texte de ton CV." };
    input = { kind: "text", text };
  }

  // Mode Cominty : l'extraction est un appel payant, réservé aux visiteurs qui ont saisi le code d'accès.
  if (isComintyMode() && !(await requestHasAccess())) return { error: ACCESS_REQUIRED_MESSAGE, text };

  try {
    return { jobId: await startImportJob(requestKey.data, input, { schedule: after }) };
  } catch (error) {
    if (error instanceof CvInputError) return { error: error.message, text };
    console.error("Import du CV :", error);
    return { error: "Erreur inattendue pendant la préparation du CV.", text };
  }
}

/** Statut de l'extraction, interrogé par la page toutes les deux secondes. */
export async function getImportJobAction(jobId: unknown): Promise<ImportJobState | { error: string }> {
  const id = z.string().min(1).safeParse(jobId);
  if (!id.success) return { error: "Import introuvable." };
  return (await getImportJob(id.data)) ?? { error: "Import introuvable." };
}
