import { describe, expect, test } from "bun:test";
import { pdfFileName } from "@/lib/letters/file-name";
import { applyEdits, editedCount, paragraphText, splitSentences, type StoredLetter } from "@/lib/letters/stored";
import { minScale } from "@/lib/letters/templates";

const letter: StoredLetter = {
  language: "fr",
  subject: "Candidature",
  salutation: "Bonjour Sarah Lemoine,",
  paragraphs: [
    { sentences: [{ text: "J'ai refondu le tableau de bord en React.", sourceIds: ["exp-acme"] }, { text: "Votre offre m'intéresse.", sourceIds: [] }] },
    { sentences: [{ text: "Je suis disponible en février 2027.", sourceIds: ["profile-availability"] }] },
  ],
  closing: "Cordialement.",
};

describe("splitSentences", () => {
  test("phrases séparées sur . ! ? suivis d'une majuscule ; abréviations et nombres gardés", () => {
    expect(splitSentences("J'ai fait ceci. Puis cela ! Et vous ?  Ensuite « citation ».")).toEqual(["J'ai fait ceci.", "Puis cela !", "Et vous ?", "Ensuite « citation »."]);
    expect(splitSentences("Précision de 12,5 % avec Node.js et C++. Fin.")).toEqual(["Précision de 12,5 % avec Node.js et C++.", "Fin."]);
  });
});

describe("applyEdits", () => {
  const edits = (paragraphs: string[]) => ({ subject: letter.subject, salutation: letter.salutation, paragraphs, closing: letter.closing });

  test("phrases inchangées : sources gardées ; phrase modifiée : sans source, marquée « modifiée par toi »", () => {
    const next = applyEdits(letter, edits([`${paragraphText(letter.paragraphs[0]).replace("m'intéresse", "me motive beaucoup")}`, paragraphText(letter.paragraphs[1])]));
    expect(next.paragraphs[0].sentences).toEqual([
      { text: "J'ai refondu le tableau de bord en React.", sourceIds: ["exp-acme"] },
      { text: "Votre offre me motive beaucoup.", sourceIds: [], edited: true },
    ]);
    expect(next.paragraphs[1].sentences[0].sourceIds).toEqual(["profile-availability"]);
    expect(editedCount(next)).toBe(1);
  });

  test("phrase déplacée d'un paragraphe à l'autre : elle garde sa source", () => {
    const next = applyEdits(letter, edits(["Je suis disponible en février 2027. J'ai refondu le tableau de bord en React."]));
    expect(next.paragraphs).toHaveLength(1);
    expect(next.paragraphs[0].sentences.map((s) => s.sourceIds)).toEqual([["profile-availability"], ["exp-acme"]]);
    expect(editedCount(next)).toBe(0);
  });

  test("paragraphe vidé retiré ; lettre entièrement vide refusée", () => {
    expect(applyEdits(letter, edits(["", paragraphText(letter.paragraphs[1])])).paragraphs).toHaveLength(1);
    expect(() => applyEdits(letter, edits(["  ", ""]))).toThrow(/au moins un paragraphe/);
  });
});

describe("export", () => {
  test("nom de fichier lisible, caractères interdits sous Windows retirés", () => {
    expect(pdfFileName("Data Scientist / ML", "Ateliers: Nova")).toBe("Lettre - Data Scientist ML - Ateliers Nova.pdf");
    expect(pdfFileName(undefined, undefined)).toBe("Lettre.pdf");
  });

  test("plancher de réduction : environ 10 pt quel que soit le template", () => {
    expect(minScale("classique") * 11).toBeCloseTo(10);
    expect(minScale("compact") * 10.5).toBeCloseTo(10);
  });
});
