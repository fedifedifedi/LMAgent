import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import path from "node:path";
import { createMockProvider } from "@/lib/llm/providers/mock";
import type { CompletionRequest, LLMProvider } from "@/lib/llm/types";
import { setupTestDatabase } from "../helpers/test-db";

await setupTestDatabase();
const { db } = await import("@/lib/db");
const { importCv } = await import("@/lib/cv/import");
const { getCvImport } = await import("@/lib/repositories/cv-imports");
const { EXTRACT_PROFILE_SYSTEM } = await import("@/lib/agent/extract-profile");

const CV_TEXT = "Léa Dubois — Data scientist junior\nData analyst — Banque Atlantique — 2024 à aujourd'hui\nPython, SQL";

function recordingMock() {
  const requests: CompletionRequest[] = [];
  const inner = createMockProvider();
  const provider: LLMProvider = { ...inner, complete: (request) => (requests.push(request), inner.complete(request)) };
  return { provider, requests };
}

describe("extractProfile (via importCv)", () => {
  test("réflexion basse, règles anti-invention dans le prompt système, CV dans le prompt", async () => {
    const { provider, requests } = recordingMock();
    await importCv({ kind: "text", text: CV_TEXT }, { provider });

    expect(requests).toHaveLength(1);
    expect(requests[0].reasoning).toBe("low");
    expect(requests[0].system).toBe(EXTRACT_PROFILE_SYSTEM);
    expect(EXTRACT_PROFILE_SYSTEM).toContain("Never add a month");
    expect(EXTRACT_PROFILE_SYSTEM).toContain("Do not summarize the CV yourself");
    expect(EXTRACT_PROFILE_SYSTEM).toContain("Never list the same work in both");
    expect(requests[0].turns[0].text).toContain("Banque Atlantique");
  });
});

describe("importCv", () => {
  test("texte collé : CvImport persisté avec texte normalisé, brouillon et usage", async () => {
    const { id } = await importCv({ kind: "text", text: `  ${CV_TEXT}\n\n\n\n` }, { provider: createMockProvider() });
    const saved = await getCvImport(id);

    expect(saved).toMatchObject({ source: "TEXT", sourceName: null, text: CV_TEXT, degraded: false, profileId: null });
    expect(saved?.draft.identity.firstName).toBe("Camille");
    expect(saved?.draft.interests).toEqual([]);
    expect(saved?.usage).toMatchObject({ provider: "mock", attempts: 1 });
  });

  test("PDF : source et nom du fichier conservés", async () => {
    const bytes = new Uint8Array(readFileSync(path.join(import.meta.dir, "..", "fixtures", "cv-sample.pdf")));
    const { id } = await importCv({ kind: "pdf", name: "cv-lea.pdf", bytes }, { provider: createMockProvider() });
    const saved = await getCvImport(id);

    expect(saved).toMatchObject({ source: "PDF", sourceName: "cv-lea.pdf" });
    expect(saved?.text).toContain("Banque Atlantique");
  });

  test("PDF illisible : erreur avant tout appel LLM, rien n'est enregistré", async () => {
    const { provider, requests } = recordingMock();
    const before = await db.cvImport.count();
    const bytes = new Uint8Array(readFileSync(path.join(import.meta.dir, "..", "fixtures", "blank.pdf")));

    await expect(importCv({ kind: "pdf", name: "scan.pdf", bytes }, { provider })).rejects.toThrow(/scan/);
    expect(requests).toHaveLength(0);
    expect(await db.cvImport.count()).toBe(before);
  });

  test("import inconnu : null", async () => {
    expect(await getCvImport("inexistant")).toBeNull();
  });
});
