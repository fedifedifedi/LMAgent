"use client";

import { useState } from "react";
import { MAX_WORDS, MIN_WORDS } from "@/lib/agent/letter-checks";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { paragraphText, type LetterEdits, type StoredLetter } from "@/lib/letters/stored";

const countWords = (text: string) => text.split(/\s+/).filter((word) => /[\p{L}\p{N}]/u.test(word)).length;

/**
 * Retouche du texte de la lettre. Les phrases inchangées gardent leur source ; une phrase modifiée ou ajoutée perd la
 * sienne et sera marquée « modifiée par toi ».
 */
export function LetterEditor({
  letter,
  saving,
  error,
  onSave,
  onCancel,
}: {
  letter: StoredLetter;
  saving: boolean;
  error: string | null;
  onSave: (edits: LetterEdits) => void;
  onCancel: () => void;
}) {
  const [subject, setSubject] = useState(letter.subject);
  const [salutation, setSalutation] = useState(letter.salutation);
  const [paragraphs, setParagraphs] = useState(() => letter.paragraphs.map(paragraphText));
  const [closing, setClosing] = useState(letter.closing);
  const words = paragraphs.reduce((total, text) => total + countWords(text), 0);
  const outOfRange = words < MIN_WORDS || words > MAX_WORDS;

  return (
    <form
      className="flex flex-col gap-4 rounded-lg border bg-card p-4"
      onSubmit={(event) => {
        event.preventDefault();
        onSave({ subject, salutation, paragraphs, closing });
      }}
    >
      <p className="text-sm text-muted-foreground">
        Les phrases que tu modifies perdent leur source et seront marquées « modifiée par toi ». Vérifie que tout ce que tu ajoutes est vrai.
      </p>
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="edit-subject">Objet</Label>
        <Input id="edit-subject" value={subject} onChange={(e) => setSubject(e.target.value)} />
      </div>
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="edit-salutation">Formule d&apos;appel</Label>
        <Input id="edit-salutation" value={salutation} onChange={(e) => setSalutation(e.target.value)} />
      </div>
      {paragraphs.map((text, index) => (
        <div key={index} className="flex flex-col gap-1.5">
          <Label htmlFor={`edit-paragraph-${index}`}>Paragraphe {index + 1}</Label>
          <Textarea
            id={`edit-paragraph-${index}`}
            value={text}
            rows={Math.max(3, Math.ceil(text.length / 90))}
            data-lenis-prevent
            onChange={(e) => setParagraphs((current) => current.map((p, i) => (i === index ? e.target.value : p)))}
          />
        </div>
      ))}
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="edit-closing">Formule de politesse</Label>
        <Input id="edit-closing" value={closing} onChange={(e) => setClosing(e.target.value)} />
      </div>
      <p className={`text-sm tabular-nums ${outOfRange ? "text-warning" : "text-muted-foreground"}`}>
        {words} mots dans les paragraphes (cible : {MIN_WORDS} à {MAX_WORDS}). Un paragraphe vidé est retiré.
      </p>
      {error && (
        <Alert variant="destructive">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}
      <div className="flex flex-wrap gap-2">
        <Button type="submit" disabled={saving}>
          {saving ? "Enregistrement…" : "Enregistrer le texte"}
        </Button>
        <Button type="button" variant="outline" disabled={saving} onClick={onCancel}>
          Annuler
        </Button>
      </div>
    </form>
  );
}
