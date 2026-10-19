import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { existsSync } from "node:fs";
import { getDocumentProxy, getMeta, extractText } from "unpdf";

// Test réel avec Edge (puppeteer-core) sur une page locale : sauté si Edge est introuvable.
const EDGE = process.env.CHROME_PATH || "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe";
const hasEdge = existsSync(EDGE);

const page = (paragraphs: number) => `<!doctype html><html><head><meta charset="utf-8"><title>Candidature au stage</title>
<style>@page { size: A4; margin: 0 } body { margin: 0 }
[data-letter-sheet] { width: 210mm; height: 297mm; box-sizing: border-box; padding: 25mm; overflow: visible; font: calc(11pt * var(--letter-scale, 1))/1.55 Georgia, serif }</style>
</head><body><article data-letter-sheet>${Array.from({ length: paragraphs }, (_, i) => `<p>Paragraphe ${i + 1} de la lettre de motivation, assez long pour remplir la page petit à petit et vérifier la réduction automatique du texte.</p>`).join("")}</article></body></html>`;

let server: ReturnType<typeof Bun.serve> | undefined;

beforeAll(() => {
  if (!hasEdge) return;
  process.env.CHROME_PATH = EDGE;
  server = Bun.serve({ port: 0, fetch: (request) => new Response(page(Number(new URL(request.url).searchParams.get("n") ?? 5)), { headers: { "content-type": "text/html; charset=utf-8" } }) });
});
afterAll(() => server?.stop(true));

describe.skipIf(!hasEdge)("renderPdf (Edge)", () => {
  test("lettre courte : une page, taille d'origine, titre = titre de la page", async () => {
    const { renderPdf } = await import("@/lib/pdf/render");
    const { pdf, scale, overflow } = await renderPdf(`http://localhost:${server!.port}/?n=5`, 10 / 11);
    const document = await getDocumentProxy(pdf);
    expect({ pages: document.numPages, scale, overflow }).toEqual({ pages: 1, scale: 1, overflow: false });
    expect((await getMeta(document)).info.Title).toBe("Candidature au stage");
    expect((await extractText(document, { mergePages: true })).text).toContain("Paragraphe 5");
  }, 60_000);

  test("lettre un peu longue : texte réduit, toujours une page", async () => {
    const { renderPdf } = await import("@/lib/pdf/render");
    // 18 paragraphes : débordent à 11 pt, tiennent vers 10,3 pt (calibré sur Edge).
    const { pdf, scale, overflow } = await renderPdf(`http://localhost:${server!.port}/?n=18`, 10 / 11);
    expect(overflow).toBe(false);
    expect(scale).toBeLessThan(1);
    expect(scale).toBeGreaterThanOrEqual(10 / 11);
    expect((await getDocumentProxy(pdf)).numPages).toBe(1);
  }, 60_000);

  test("lettre trop longue : plancher atteint, débordement signalé", async () => {
    const { renderPdf } = await import("@/lib/pdf/render");
    const { scale, overflow } = await renderPdf(`http://localhost:${server!.port}/?n=40`, 10 / 11);
    expect(overflow).toBe(true);
    expect(scale).toBeCloseTo(10 / 11, 3);
  }, 60_000);
});

describe("renderPdf : configuration", () => {
  test("CHROME_PATH absent ou invalide : message clair", async () => {
    const { renderPdf } = await import("@/lib/pdf/render");
    const saved = process.env.CHROME_PATH;
    try {
      process.env.CHROME_PATH = "";
      await expect(renderPdf("http://localhost/", 0.9)).rejects.toThrow(/ajoute CHROME_PATH dans \.env\.local/);
      process.env.CHROME_PATH = "C:\\nulle-part\\msedge.exe";
      await expect(renderPdf("http://localhost/", 0.9)).rejects.toThrow(/ne mène à aucun fichier/);
    } finally {
      process.env.CHROME_PATH = saved;
    }
  });
});
