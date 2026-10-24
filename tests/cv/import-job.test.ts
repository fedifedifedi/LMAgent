import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import path from "node:path";
import { createMockProvider } from "@/lib/llm/providers/mock";
import type { CompletionRequest, LLMProvider } from "@/lib/llm/types";
import { setupTestDatabase } from "../helpers/test-db";

await setupTestDatabase();
const { db } = await import("@/lib/db");
const { getImportJob, startImportJob, TIMEOUT_MESSAGE } = await import("@/lib/cv/import-job");

const CV_TEXT = readFileSync(path.join(import.meta.dir, "..", "fixtures", "cv-sample.pdf"));
const pdf = { kind: "file" as const, name: "cv.pdf", bytes: new Uint8Array(CV_TEXT) };
/** CV texte unique : chaque test appelle vraiment l'agent (pas de résultat réutilisé d'un autre test). */
const uniqueCv = () => ({ kind: "text" as const, text: `Léa Dubois — Data scientist junior. Stage Banque Atlantique, Python, SQL. Réf. ${crypto.randomUUID()}` });

/** Exécute la tâche d'arrière-plan et permet de l'attendre (after() de Next dans l'application). */
function scheduler() {
  const tasks: Array<Promise<void>> = [];
  return { schedule: (task: () => Promise<void>) => void tasks.push(task()), done: () => Promise.all(tasks) };
}

/** Provider qui compte ses appels ; `name` "cominty" pour vérifier la règle d'une seule tentative. */
function counting(name: "mock" | "cominty", respond?: (request: CompletionRequest) => Promise<{ text: string }>) {
  const requests: CompletionRequest[] = [];
  const inner = createMockProvider();
  const provider: LLMProvider = {
    name,
    model: "test",
    complete: async (request) => {
      requests.push(request);
      if (respond) return { ...(await respond(request)), usage: { inputTokens: 1, outputTokens: 1 } };
      return inner.complete(request);
    },
  };
  return { provider, requests };
}

describe("import du CV en arrière-plan", () => {
  test("PDF texte : job immédiat, extraction en arrière-plan, import créé ; le texte (pas le fichier) part à l'agent", async () => {
    const { provider, requests } = counting("mock");
    const run = scheduler();
    const jobId = await startImportJob(crypto.randomUUID(), pdf, { provider, schedule: run.schedule });
    await run.done();
    const job = (await getImportJob(jobId))!;
    expect(job.status).toBe("DONE");
    expect(await db.cvImport.findUnique({ where: { id: job.importId! } })).not.toBeNull();
    expect(requests).toHaveLength(1);
    expect(requests[0].attachments).toBeUndefined();
    expect(requests[0].turns[0].text).toContain("Léa Dubois");
  });

  test("même requête reçue deux fois (proxy, double clic) : un seul job, un seul appel à l'agent", async () => {
    const { provider, requests } = counting("mock");
    const run = scheduler();
    const key = crypto.randomUUID();
    const cv = uniqueCv();
    const [a, b] = [await startImportJob(key, cv, { provider, schedule: run.schedule }), await startImportJob(key, cv, { provider, schedule: run.schedule })];
    await run.done();
    expect(b).toBe(a);
    expect(requests).toHaveLength(1);
    expect(await db.cvImportJob.count({ where: { requestKey: key } })).toBe(1);
  });

  test("Cominty : une seule tentative, pas de message de relance ; le schéma tolérant récupère la sortie", async () => {
    const { provider, requests } = counting("cominty", async () => ({ text: JSON.stringify({ identity: { firstName: "Léa" }, experiences: [{ title: "Data analyst" }] }) }));
    const run = scheduler();
    const jobId = await startImportJob(crypto.randomUUID(), uniqueCv(), { provider, schedule: run.schedule });
    await run.done();
    expect(requests).toHaveLength(1);
    const job = (await getImportJob(jobId))!;
    expect(job.status).toBe("DONE");
    expect((await db.cvImport.findUniqueOrThrow({ where: { id: job.importId! } })).degraded).toBe(true);
  });

  test("délai dépassé : extraction abandonnée (signal transmis à l'agent), message clair", async () => {
    let aborted = false;
    const { provider } = counting("cominty", (request) =>
      new Promise((_, reject) =>
        request.signal?.addEventListener("abort", () => {
          aborted = true;
          reject(new Error("aborted"));
        }),
      ),
    );
    const run = scheduler();
    const jobId = await startImportJob(crypto.randomUUID(), uniqueCv(), { provider, schedule: run.schedule, timeoutMs: 30 });
    await run.done();
    expect(aborted).toBe(true);
    expect(await getImportJob(jobId)).toMatchObject({ status: "FAILED", error: TIMEOUT_MESSAGE });
  });

  test("même CV déjà analysé : résultat réutilisé tout de suite, sans appel ni coût", async () => {
    const cv = uniqueCv();
    const first = counting("mock");
    const run = scheduler();
    await startImportJob(crypto.randomUUID(), cv, { provider: first.provider, schedule: run.schedule });
    const second = counting("mock");
    const jobId = await startImportJob(crypto.randomUUID(), cv, { provider: second.provider, schedule: run.schedule });
    await run.done();
    expect(first.requests).toHaveLength(1);
    expect(second.requests).toHaveLength(0);
    const job = (await getImportJob(jobId))!;
    const reused = await db.cvImport.findUniqueOrThrow({ where: { id: job.importId! } });
    expect(reused.usage).toMatchObject({ cached: true, inputTokens: 0, outputTokens: 0 });
  });

  test("cache invalidé quand l'agent d'extraction (ou les règles) change : pas de réutilisation", async () => {
    const cv = uniqueCv();
    const run = scheduler();
    const oldAgent = counting("cominty");
    await startImportJob(crypto.randomUUID(), cv, { provider: oldAgent.provider, schedule: run.schedule });
    await run.done();
    // Même CV, autre agent (COMINTY_EXTRACT_AGENT_ID changé) : nouvelle extraction.
    const newAgent = { ...counting("cominty"), } ;
    const provider = { ...newAgent.provider, model: "agent:nouvel-agent" };
    await startImportJob(crypto.randomUUID(), cv, { provider, schedule: run.schedule });
    await run.done();
    expect(oldAgent.requests).toHaveLength(1);
    expect(newAgent.requests).toHaveLength(1);
    const { extractionKey } = await import("@/lib/agent/extract-profile");
    expect(extractionKey({ name: "cominty", model: "agent:a" })).not.toBe(extractionKey({ name: "cominty", model: "agent:b" }));
  });

  test("lire le texte d'un PDF ne vide pas le fichier (encore nécessaire pour un PDF scanné)", async () => {
    const { cvTextFromPdf } = await import("@/lib/cv/extract-text");
    const bytes = new Uint8Array(CV_TEXT);
    await cvTextFromPdf(bytes);
    expect(bytes.byteLength).toBe(CV_TEXT.byteLength);
  });

  test("fichier refusé (format) : erreur immédiate, aucun job ni appel", async () => {
    const { provider, requests } = counting("mock");
    const before = await db.cvImportJob.count();
    const error = await startImportJob(crypto.randomUUID(), { kind: "file", name: "cv.txt", bytes: new TextEncoder().encode("bonjour") }, { provider, schedule: () => {} }).catch((e) => e);
    expect(error).toBeInstanceOf(Error);
    expect(await db.cvImportJob.count()).toBe(before);
    expect(requests).toHaveLength(0);
  });
});
