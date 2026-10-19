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
const { EXTRACT_PROFILE_SYSTEM, NATIVE_READING_RULE } = await import("@/lib/agent/extract-profile");
const { MAX_IMAGE_BYTES } = await import("@/lib/cv/extract-text");

const CV_TEXT = "Léa Dubois — Data scientist junior\nData analyst — Banque Atlantique — 2024 à aujourd'hui\nPython, SQL";
const fixture = (name: string) => new Uint8Array(readFileSync(path.join(import.meta.dir, "..", "fixtures", name)));

function recordingMock() {
  const requests: CompletionRequest[] = [];
  const inner = createMockProvider();
  const provider: LLMProvider = { ...inner, complete: (request) => (requests.push(request), inner.complete(request)) };
  return { provider, requests };
}

describe("extractProfile (via importCv)", () => {
  test("texte : réflexion basse, règles anti-invention, CV dans le prompt, aucun fichier joint", async () => {
    const { provider, requests } = recordingMock();
    await importCv({ kind: "text", text: CV_TEXT }, { provider });

    expect(requests).toHaveLength(1);
    expect(requests[0].reasoning).toBe("low");
    expect(requests[0].system).toBe(EXTRACT_PROFILE_SYSTEM);
    expect(requests[0].attachments).toBeUndefined();
    expect(EXTRACT_PROFILE_SYSTEM).toContain("Never add a month");
    expect(EXTRACT_PROFILE_SYSTEM).toContain("Do not summarize the CV yourself");
    expect(EXTRACT_PROFILE_SYSTEM).toContain("Never list the same work in both");
    expect(requests[0].turns[0].text).toContain("Banque Atlantique");
  });

  test("image : fichier joint tel quel, règle « omettre l'illisible » ajoutée au prompt système", async () => {
    const { provider, requests } = recordingMock();
    const png = fixture("cv-sample.png");
    await importCv({ kind: "file", name: "cv.png", bytes: png }, { provider });

    expect(requests[0].attachments).toEqual([{ mimeType: "image/png", data: png }]);
    expect(requests[0].system).toBe(`${EXTRACT_PROFILE_SYSTEM}\n${NATIVE_READING_RULE}`);
    expect(NATIVE_READING_RULE).toContain("omit it rather than guess");
    expect(requests[0].reasoning).toBe("low");
  });
});

describe("importCv", () => {
  test("texte collé : CvImport persisté avec texte normalisé, brouillon et usage", async () => {
    const { id } = await importCv({ kind: "text", text: `  ${CV_TEXT}\n\n\n\n` }, { provider: createMockProvider() });
    const saved = await getCvImport(id);

    expect(saved).toMatchObject({ source: "TEXT", readMode: "TEXT", sourceName: null, text: CV_TEXT, degraded: false });
    expect(saved?.draft.identity.firstName).toBe("Camille");
    expect(saved?.usage).toMatchObject({ provider: "mock", attempts: 1 });
  });

  test("PDF avec texte : texte extrait, pas de fichier joint", async () => {
    const { provider, requests } = recordingMock();
    const { id } = await importCv({ kind: "file", name: "cv-lea.pdf", bytes: fixture("cv-sample.pdf") }, { provider });

    expect(await getCvImport(id)).toMatchObject({ source: "PDF", readMode: "TEXT", sourceName: "cv-lea.pdf" });
    expect(requests[0].attachments).toBeUndefined();
    expect(requests[0].turns[0].text).toContain("Banque Atlantique");
  });

  test("PDF scanné (sans texte) : lecture native automatique du PDF", async () => {
    const { provider, requests } = recordingMock();
    const scan = fixture("blank.pdf");
    const { id } = await importCv({ kind: "file", name: "scan.pdf", bytes: scan }, { provider });

    expect(await getCvImport(id)).toMatchObject({ source: "PDF", readMode: "NATIVE", text: null });
    expect(requests[0].attachments).toEqual([{ mimeType: "application/pdf", data: scan }]);
  });

  test("image : source IMAGE, lecture native, pas de texte ; tokens du fichier comptés (estimés)", async () => {
    const { id } = await importCv({ kind: "file", name: "cv.png", bytes: fixture("cv-sample.png") }, { provider: createMockProvider() });
    const saved = await getCvImport(id);

    expect(saved).toMatchObject({ source: "IMAGE", readMode: "NATIVE", sourceName: "cv.png", text: null });
    expect(saved?.usage.inputTokens).toBeGreaterThan(1000);
    expect(saved?.usage.estimated).toBe(true);
  });

  test("refus avant tout appel LLM : HEIC, format inconnu, image trop lourde ; rien n'est enregistré", async () => {
    const { provider, requests } = recordingMock();
    const before = await db.cvImport.count();
    const heic = new Uint8Array([0, 0, 0, 24, ...new TextEncoder().encode("ftypheic"), 0, 0]);
    const docx = new Uint8Array([0x50, 0x4b, 3, 4, 0, 0]);
    const bigJpeg = new Uint8Array(MAX_IMAGE_BYTES + 1);
    bigJpeg.set([0xff, 0xd8, 0xff, 0xe0]);

    await expect(importCv({ kind: "file", name: "IMG.heic", bytes: heic }, { provider })).rejects.toThrow(/convertis-la en JPG/);
    await expect(importCv({ kind: "file", name: "cv.docx", bytes: docx }, { provider })).rejects.toThrow(/Format non pris en charge/);
    // Extension trompeuse : c'est le contenu qui compte.
    await expect(importCv({ kind: "file", name: "cv.pdf", bytes: heic }, { provider })).rejects.toThrow(/HEIC/);
    await expect(importCv({ kind: "file", name: "cv.jpg", bytes: bigJpeg }, { provider })).rejects.toThrow(/L'image dépasse 4 Mo/);

    expect(requests).toHaveLength(0);
    expect(await db.cvImport.count()).toBe(before);
  });

  test("import inconnu : null", async () => {
    expect(await getCvImport("inexistant")).toBeNull();
  });
});
