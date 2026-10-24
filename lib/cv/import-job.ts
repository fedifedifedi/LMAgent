import { CvInputError } from "@/lib/cv/extract-text";
import { extractAndSave, prepareCv, type CvInput } from "@/lib/cv/import";
import { db } from "@/lib/db";
import { getProvider, LLMError, LLMValidationError } from "@/lib/llm";
import type { LLMProvider } from "@/lib/llm/types";

/** Délai maximum d'un import : au-delà, l'extraction est abandonnée (et arrêtée chez Cominty) et la page propose de réessayer. */
export const IMPORT_TIMEOUT_MS = 90_000;
/** Marge pour que l'échec soit enregistré avant que la page n'affiche elle-même le dépassement. */
const SERVER_TIMEOUT_MS = IMPORT_TIMEOUT_MS - 5_000;

export const TIMEOUT_MESSAGE = "L'agent n'a pas répondu en 90 secondes. Réessaie : un CV en PDF texte prend en général moins d'une minute.";

export type ImportJobState = { status: "PENDING" | "DONE" | "FAILED"; importId?: string; error?: string; elapsedMs: number };

function failureMessage(error: unknown): string {
  if (error instanceof CvInputError) return error.message;
  if (error instanceof LLMValidationError) return "L'agent n'a pas produit de profil exploitable. Réessaie, ou colle le texte du CV.";
  if (error instanceof LLMError) return error.message;
  console.error("Import du CV :", error);
  return "Erreur inattendue pendant l'analyse du CV.";
}

/**
 * Démarre l'import d'un CV en arrière-plan et renvoie l'id du job. Le CV est préparé tout de suite (texte d'un PDF lu
 * par le serveur : erreurs de fichier renvoyées immédiatement), puis l'extraction tourne via `schedule` (after() de Next).
 * Idempotent : une même requestKey (requête répétée par le navigateur ou le proxy) renvoie le job existant, sans
 * nouvel appel — une seule session Cominty par import.
 */
export async function startImportJob(
  requestKey: string,
  input: CvInput,
  options: { provider?: LLMProvider; schedule: (task: () => Promise<void>) => void; timeoutMs?: number },
): Promise<string> {
  const existing = await db.cvImportJob.findUnique({ where: { requestKey }, select: { id: true } });
  if (existing) return existing.id;

  const prepared = await prepareCv(input);
  let job;
  try {
    job = await db.cvImportJob.create({ data: { requestKey }, select: { id: true } });
  } catch {
    // Deux requêtes identiques en même temps : la seconde récupère le job de la première.
    return (await db.cvImportJob.findUniqueOrThrow({ where: { requestKey }, select: { id: true } })).id;
  }

  const provider = options.provider ?? getProvider();
  options.schedule(async () => {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), options.timeoutMs ?? SERVER_TIMEOUT_MS);
    try {
      // Cominty : une seule tentative (pas de message de relance) ; le schéma tolérant récupère ce qui peut l'être.
      const { id: importId } = await extractAndSave(prepared, input.kind === "file" ? input.name : undefined, {
        provider,
        maxAttempts: provider.name === "cominty" ? 1 : undefined,
        signal: controller.signal,
      });
      await db.cvImportJob.update({ where: { id: job.id }, data: { status: "DONE", importId, finishedAt: new Date() } });
    } catch (error) {
      const message = controller.signal.aborted ? TIMEOUT_MESSAGE : failureMessage(error);
      await db.cvImportJob.update({ where: { id: job.id }, data: { status: "FAILED", error: message, finishedAt: new Date() } });
    } finally {
      clearTimeout(timer);
    }
  });
  return job.id;
}

export async function getImportJob(jobId: string): Promise<ImportJobState | null> {
  const job = await db.cvImportJob.findUnique({ where: { id: jobId } });
  if (!job) return null;
  const elapsedMs = (job.finishedAt ?? new Date()).getTime() - job.createdAt.getTime();
  // Garde-fou si le processus a redémarré pendant l'extraction : un job PENDING trop vieux est un échec.
  if (job.status === "PENDING" && elapsedMs > IMPORT_TIMEOUT_MS + 30_000) return { status: "FAILED", error: TIMEOUT_MESSAGE, elapsedMs };
  return { status: job.status, importId: job.importId ?? undefined, error: job.error ?? undefined, elapsedMs };
}
