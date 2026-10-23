import { extractProfile, type CvSourceContent } from "@/lib/agent/extract-profile";
import { cvTextFromPaste, cvTextFromPdf, CvInputError, MAX_IMAGE_BYTES, MAX_PDF_BYTES } from "@/lib/cv/extract-text";
import { detectCvFileType, MIME_TYPES } from "@/lib/cv/file-type";
import type { CvReadMode, CvSource } from "@/lib/generated/prisma/enums";
import type { LLMProvider } from "@/lib/llm/types";
import { createCvImport } from "@/lib/repositories/cv-imports";

export type CvInput = { kind: "file"; name: string; bytes: Uint8Array } | { kind: "text"; text: string };

export type PreparedCv = { source: CvSource; readMode: CvReadMode; text: string | null; content: CvSourceContent };

const megabytes = (bytes: number) => `${bytes / 1024 / 1024} Mo`;

/**
 * Texte collé → texte. PDF avec texte → texte (unpdf). PDF scanné ou image → lecture native par le modèle.
 * Le type est déterminé par les octets du fichier, pas par son extension.
 */
export async function prepareCv(input: CvInput): Promise<PreparedCv> {
  if (input.kind === "text") {
    const text = cvTextFromPaste(input.text);
    return { source: "TEXT", readMode: "TEXT", text, content: { text } };
  }

  const type = detectCvFileType(input.bytes);
  if (type === "heic") {
    throw new CvInputError("Les photos HEIC (iPhone) ne sont pas prises en charge : convertis-la en JPG puis réessaie.");
  }
  if (type === null) throw new CvInputError("Format non pris en charge : envoie un PDF, un JPG, un PNG ou un WebP.");

  if (type === "pdf") {
    if (input.bytes.byteLength > MAX_PDF_BYTES) throw new CvInputError(`Le PDF dépasse ${megabytes(MAX_PDF_BYTES)}.`);
    const text = await cvTextFromPdf(input.bytes);
    if (text !== null) return { source: "PDF", readMode: "TEXT", text, content: { text } };
    // Pas de couche texte (scan) : le modèle lit le PDF lui-même.
    return { source: "PDF", readMode: "NATIVE", text: null, content: { file: { mimeType: MIME_TYPES.pdf, data: input.bytes } } };
  }

  if (input.bytes.byteLength > MAX_IMAGE_BYTES) throw new CvInputError(`L'image dépasse ${megabytes(MAX_IMAGE_BYTES)}.`);
  return { source: "IMAGE", readMode: "NATIVE", text: null, content: { file: { mimeType: MIME_TYPES[type], data: input.bytes } } };
}

/** CV → brouillon LLM → CvImport persisté. Les erreurs (CvInputError, LLMError) remontent telles quelles. */
export async function importCv(input: CvInput, options: { provider?: LLMProvider } = {}): Promise<{ id: string }> {
  return extractAndSave(await prepareCv(input), input.kind === "file" ? input.name : undefined, options);
}

/** Extraction d'un CV déjà préparé (texte lu par le serveur, ou fichier pour la lecture native), puis CvImport. */
export async function extractAndSave(
  prepared: PreparedCv,
  sourceName: string | undefined,
  options: { provider?: LLMProvider; maxAttempts?: number; signal?: AbortSignal } = {},
): Promise<{ id: string }> {
  const result = await extractProfile(prepared.content, options);
  return createCvImport({
    source: prepared.source,
    readMode: prepared.readMode,
    sourceName,
    text: prepared.text,
    draft: result.data,
    degraded: result.degraded,
    issues: result.issues,
    usage: result.usage,
  });
}
