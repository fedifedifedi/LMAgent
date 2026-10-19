import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import path from "node:path";
import { cvTextFromPaste, cvTextFromPdf, CvTextError, MAX_CV_CHARS, MAX_PDF_BYTES, normalizeCvText } from "@/lib/cv/extract-text";

// PDF générés avec Edge headless (--print-to-pdf) : un CV d'une page, et une page sans texte (simule un scan).
const fixture = (name: string) => new Uint8Array(readFileSync(path.join(import.meta.dir, "..", "fixtures", name)));

describe("cvTextFromPdf", () => {
  test("extrait le texte d'un PDF, accents et caractères spéciaux compris", async () => {
    const text = await cvTextFromPdf(fixture("cv-sample.pdf"));
    for (const expected of ["Léa Dubois", "Banque Atlantique", "+12 % de précision", "C++", "Node.js"]) {
      expect(text).toContain(expected);
    }
    expect(text).not.toMatch(/\n{3,}/);
  });

  test("PDF sans couche texte (scan) : message invitant à coller le texte", async () => {
    await expect(cvTextFromPdf(fixture("blank.pdf"))).rejects.toThrow(/scan.*Colle le texte/);
  });

  test("fichier qui n'est pas un PDF", async () => {
    await expect(cvTextFromPdf(new TextEncoder().encode("Bonjour, ceci est un .docx"))).rejects.toThrow("Le fichier n'est pas un PDF.");
  });

  test("PDF trop lourd, refusé avant lecture", async () => {
    const big = new Uint8Array(MAX_PDF_BYTES + 1);
    big.set(new TextEncoder().encode("%PDF-"));
    await expect(cvTextFromPdf(big)).rejects.toBeInstanceOf(CvTextError);
    await expect(cvTextFromPdf(big)).rejects.toThrow(/dépasse 5 Mo/);
  });

  test("PDF corrompu", async () => {
    await expect(cvTextFromPdf(new TextEncoder().encode("%PDF-1.7 n'importe quoi"))).rejects.toThrow(/Impossible de lire ce PDF/);
  });
});

describe("cvTextFromPaste", () => {
  test("normalise espaces et lignes vides sans toucher au contenu", () => {
    expect(normalizeCvText("  Léa  Dubois \r\n\r\n\r\n\tPython,   SQL  ")).toBe("Léa Dubois\n\nPython, SQL");
  });

  test("texte trop court ou trop long : refusé, jamais tronqué", () => {
    expect(() => cvTextFromPaste("   Léa   ")).toThrow(/vide ou trop court/);
    expect(() => cvTextFromPaste("a".repeat(MAX_CV_CHARS + 1))).toThrow(/au-delà de la limite/);
  });
});
