import { z } from "zod";

/** Lettre enregistrée : sortie de l'agent, plus les retouches de l'utilisateur (phrases `edited`, sans source). */
export const StoredLetterSchema = z.object({
  language: z.enum(["fr", "en"]),
  subject: z.string().min(1),
  salutation: z.string().min(1),
  paragraphs: z
    .array(
      z.object({
        sentences: z
          .array(z.object({ text: z.string().min(1), sourceIds: z.array(z.string()), edited: z.boolean().optional() }))
          .min(1),
      }),
    )
    .min(1),
  closing: z.string().min(1),
});
export type StoredLetter = z.infer<typeof StoredLetterSchema>;

/** Texte édité par l'utilisateur : un champ par partie, un paragraphe par zone de texte. */
export const LetterEditsSchema = z.object({
  subject: z.string().trim().min(1, "L'objet ne peut pas être vide."),
  salutation: z.string().trim().min(1, "La formule d'appel ne peut pas être vide."),
  paragraphs: z.array(z.string()).max(12),
  closing: z.string().trim().min(1, "La formule de politesse ne peut pas être vide."),
});
export type LetterEdits = z.infer<typeof LetterEditsSchema>;

/** Découpe un paragraphe en phrases (fin . ! ? … suivie d'une majuscule, d'un chiffre ou d'un guillemet). */
export function splitSentences(paragraph: string): string[] {
  return paragraph
    .replace(/\s+/g, " ")
    .trim()
    .split(/(?<=[.!?…])\s+(?=[\p{Lu}\d«"“(])/u)
    .map((sentence) => sentence.trim())
    .filter(Boolean);
}

export const paragraphText = (paragraph: StoredLetter["paragraphs"][number]) => paragraph.sentences.map((s) => s.text).join(" ");

/**
 * Applique les retouches : une phrase identique à une phrase existante garde ses sources (et son marquage) ;
 * une phrase modifiée ou ajoutée perd sa source et est marquée `edited` (« modifiée par toi »).
 * Les paragraphes vidés sont retirés.
 */
export function applyEdits(previous: StoredLetter, edits: LetterEdits): StoredLetter {
  const known = new Map<string, StoredLetter["paragraphs"][number]["sentences"][number]>();
  for (const paragraph of previous.paragraphs) for (const sentence of paragraph.sentences) known.set(sentence.text.trim(), sentence);

  const paragraphs = edits.paragraphs
    .map((text) => splitSentences(text))
    .filter((sentences) => sentences.length > 0)
    .map((sentences) => ({
      sentences: sentences.map((text) => {
        const same = known.get(text);
        return same ? { ...same, text } : { text, sourceIds: [], edited: true };
      }),
    }));
  if (paragraphs.length === 0) throw new Error("La lettre doit garder au moins un paragraphe.");

  return { language: previous.language, subject: edits.subject.trim(), salutation: edits.salutation.trim(), paragraphs, closing: edits.closing.trim() };
}

export const editedCount = (letter: StoredLetter) => letter.paragraphs.reduce((n, p) => n + p.sentences.filter((s) => s.edited).length, 0);
