"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import type { ComintyQuestion } from "@/lib/cominty/schemas";

export type QuestionAnswer = { prompt: string; answer: string };

/** Option « Autre (je précise…) » : ouvre un champ libre au lieu d'envoyer le libellé. */
const isOther = (option: string) => /^autres?\b|^other\b/i.test(option.trim());

/**
 * Questions natives de l'agent Cominty, en boutons. Une seule question : un clic sur une option envoie la réponse.
 * Plusieurs questions (ou « Autre ») : on choisit, puis on envoie.
 */
export function AgentQuestions({ questions, busy, error, onSubmit }: { questions: ComintyQuestion[]; busy: boolean; error: string | null; onSubmit: (answers: QuestionAnswer[]) => void }) {
  const [choices, setChoices] = useState<Record<number, string>>({});
  const [free, setFree] = useState<Record<number, string>>({});
  const [freeOpen, setFreeOpen] = useState<Record<number, boolean>>({});
  const single = questions.length === 1;

  const answers = questions.map((q, i) => ({ prompt: q.prompt, answer: freeOpen[i] ? (free[i] ?? "").trim() : (choices[i] ?? "") }));
  const complete = answers.every((a) => a.answer.length > 0);

  function choose(index: number, option: string) {
    if (isOther(option)) {
      setFreeOpen((s) => ({ ...s, [index]: true }));
      setChoices((s) => ({ ...s, [index]: "" }));
      return;
    }
    setFreeOpen((s) => ({ ...s, [index]: false }));
    if (single) {
      onSubmit([{ prompt: questions[index].prompt, answer: option }]);
      return;
    }
    setChoices((s) => ({ ...s, [index]: option }));
  }

  return (
    <section aria-label="Questions de l'agent" className="flex flex-col gap-4 rounded-xl border border-primary/40 bg-card p-4">
      <div className="flex flex-col gap-1">
        <h2 className="font-heading text-2xl">L&apos;agent a besoin d&apos;une précision</h2>
        <p className="text-sm text-muted-foreground">Ta réponse servira uniquement pour cette lettre, citée comme « Tes réponses à l&apos;agent ».</p>
      </div>
      {questions.map((question, index) => (
        <fieldset key={question.prompt} className="flex flex-col gap-2" disabled={busy}>
          <legend className="mb-1 font-medium">{question.prompt}</legend>
          <div className="flex flex-wrap gap-2">
            {question.options.map((option) => {
              const pressed = isOther(option) ? Boolean(freeOpen[index]) : choices[index] === option;
              return (
                <button
                  key={option}
                  type="button"
                  aria-pressed={pressed}
                  onClick={() => choose(index, option)}
                  className="rounded-full border bg-background px-3 py-1.5 text-left text-sm font-medium hover:border-primary disabled:opacity-50 aria-pressed:border-primary aria-pressed:bg-primary aria-pressed:text-primary-foreground"
                >
                  {option}
                </button>
              );
            })}
            {!question.options.some(isOther) && (
              <button type="button" aria-pressed={Boolean(freeOpen[index])} onClick={() => setFreeOpen((s) => ({ ...s, [index]: !s[index] }))} className="px-2 text-sm underline underline-offset-2">
                Répondre autrement
              </button>
            )}
          </div>
          {freeOpen[index] && (
            <textarea
              aria-label={`Ta réponse : ${question.prompt}`}
              value={free[index] ?? ""}
              onChange={(event) => setFree((s) => ({ ...s, [index]: event.target.value }))}
              rows={2}
              maxLength={2000}
              className="w-full rounded-md border bg-background px-3 py-2 text-sm"
              placeholder="Écris ta réponse, avec un fait précis si possible."
              data-lenis-prevent
            />
          )}
        </fieldset>
      ))}
      {error && <p className="text-sm text-destructive">{error}</p>}
      {(!single || Object.values(freeOpen).some(Boolean)) && (
        <div>
          <Button type="button" className="btn-shine" disabled={busy || !complete} onClick={() => onSubmit(answers)}>
            {busy ? "Envoi…" : questions.length > 1 ? "Envoyer mes réponses" : "Envoyer ma réponse"}
          </Button>
        </div>
      )}
    </section>
  );
}
