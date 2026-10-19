import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import path from "node:path";
import { cvTextFromPaste, cvTextFromPdf, MAX_CV_CHARS, normalizeCvText } from "@/lib/cv/extract-text";
import { detectCvFileType } from "@/lib/cv/file-type";
import { fitWithin, isHeicFile, isImageFile } from "@/lib/cv/resize-image";

// Générés avec Edge headless : un CV d'une page (PDF et capture PNG), et une page PDF sans texte (simule un scan).
const fixture = (name: string) => new Uint8Array(readFileSync(path.join(import.meta.dir, "..", "fixtures", name)));
const bytes = (...values: Array<number | string>) =>
  new Uint8Array(values.flatMap((value) => (typeof value === "string" ? [...value].map((c) => c.charCodeAt(0)) : [value])));

describe("cvTextFromPdf", () => {
  test("extrait le texte d'un PDF, accents et caractères spéciaux compris", async () => {
    const text = await cvTextFromPdf(fixture("cv-sample.pdf"));
    for (const expected of ["Léa Dubois", "Banque Atlantique", "+12 % de précision", "C++", "Node.js"]) {
      expect(text).toContain(expected);
    }
    expect(text).not.toMatch(/\n{3,}/);
  });

  test("PDF sans couche texte (scan) : null, pour basculer en lecture native", async () => {
    expect(await cvTextFromPdf(fixture("blank.pdf"))).toBeNull();
  });

  test("PDF corrompu", async () => {
    await expect(cvTextFromPdf(new TextEncoder().encode("%PDF-1.7 n'importe quoi"))).rejects.toThrow(/Impossible de lire ce PDF/);
  });
});

describe("detectCvFileType : d'après les octets, pas l'extension", () => {
  test("fixtures réelles", () => {
    expect(detectCvFileType(fixture("cv-sample.pdf"))).toBe("pdf");
    expect(detectCvFileType(fixture("cv-sample.png"))).toBe("png");
  });

  test("en-têtes JPEG, WebP, HEIC, inconnu", () => {
    expect(detectCvFileType(bytes(0xff, 0xd8, 0xff, 0xe0))).toBe("jpeg");
    expect(detectCvFileType(bytes("RIFF", 0, 0, 0, 0, "WEBPVP8 "))).toBe("webp");
    expect(detectCvFileType(bytes(0, 0, 0, 24, "ftypheic"))).toBe("heic");
    expect(detectCvFileType(bytes(0, 0, 0, 24, "ftypmif1"))).toBe("heic");
    expect(detectCvFileType(bytes(0, 0, 0, 24, "ftypmp42"))).toBeNull(); // vidéo MP4
    expect(detectCvFileType(bytes("PK", 3, 4))).toBeNull(); // .docx (zip)
    expect(detectCvFileType(new Uint8Array())).toBeNull();
  });
});

describe("préparation des images (navigateur)", () => {
  test("fitWithin : grand côté ramené à 2 000 px, proportions gardées, jamais agrandi", () => {
    expect(fitWithin(4032, 3024)).toEqual({ width: 2000, height: 1500 });
    expect(fitWithin(3024, 4032)).toEqual({ width: 1500, height: 2000 });
    expect(fitWithin(800, 600)).toEqual({ width: 800, height: 600 });
  });

  test("HEIC et images reconnus par type MIME ou extension", () => {
    expect(isHeicFile({ name: "IMG_0001.HEIC", type: "" })).toBe(true);
    expect(isHeicFile({ name: "cv", type: "image/heif" })).toBe(true);
    expect(isImageFile({ name: "cv.JPG", type: "" })).toBe(true);
    expect(isImageFile({ name: "cv.pdf", type: "application/pdf" })).toBe(false);
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
