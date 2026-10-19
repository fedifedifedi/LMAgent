import { extractProfile } from "@/lib/agent/extract-profile";
import { cvTextFromPaste, cvTextFromPdf } from "@/lib/cv/extract-text";
import type { LLMProvider } from "@/lib/llm/types";
import { createCvImport } from "@/lib/repositories/cv-imports";

export type CvInput = { kind: "pdf"; name: string; bytes: Uint8Array } | { kind: "text"; text: string };

/** Texte du CV → brouillon LLM → CvImport persisté. Les erreurs (CvTextError, LLMError) remontent telles quelles. */
export async function importCv(input: CvInput, options: { provider?: LLMProvider } = {}): Promise<{ id: string }> {
  const text = input.kind === "pdf" ? await cvTextFromPdf(input.bytes) : cvTextFromPaste(input.text);
  const result = await extractProfile(text, options);
  return createCvImport({
    source: input.kind === "pdf" ? "PDF" : "TEXT",
    sourceName: input.kind === "pdf" ? input.name : undefined,
    text,
    draft: result.data,
    degraded: result.degraded,
    issues: result.issues,
    usage: result.usage,
  });
}
