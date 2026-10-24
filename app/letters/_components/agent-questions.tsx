"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { ANSWER_OPTIONS, type AgentQuestion, type AnswerChoice, type CandidateAnswer } from "@/lib/agent/questions";

const CHOICES = Object.entries(ANSWER_OPTIONS) as Array<[AnswerChoice, string]>;

/**
 * Questions de l'agent sur les exigences que le CV ne prouve pas : 4 boutons par question. « Oui » ouvre un champ
 * obligatoire (le projet ou l'expérience) ; l'envoi reste bloqué tant qu'il est vide. « Rédiger sans répondre » passe tout.
 */
export function AgentQuestions({ questions, busy, error, onSubmit }: { questions: AgentQuestion[]; busy: boolean; error: string | null; onSubmit: (answers: CandidateAnswer[]) => void }) {
  const [choices, setChoices] = useState<Record<number, AnswerChoice>>({});
  const [details, setDetails] = useState<Record<number, string>>({});

  const answers: CandidateAnswer[] = questions.map((q, i) => ({
    prompt: q.prompt,
    ...(q.requirement ? { requirement: q.requirement } : {}),
    choice: choices[i] ?? "skip",
    ...(choices[i] === "yes" ? { detail: (details[i] ?? "").trim() } : {}),
  }));
  const allChosen = questions.every((_, i) => choices[i] !== undefined);
  const missingDetail = questions.some((_, i) => choices[i] === "yes" && !(details[i] ?? "").trim());
  const skipAll = () => onSubmit(questions.map((q) => ({ prompt: q.prompt, ...(q.requirement ? { requirement: q.requirement } : {}), choice: "skip" as const })));

  return (
    <section aria-label="Questions de l'agent" className="flex flex-col gap-4 rounded-xl border border-primary/40 bg-card p-4">
      <div className="flex flex-col gap-1">
        <h2 className="font-heading text-2xl">L&apos;agent vérifie avant d&apos;écrire</h2>
        <p className="text-sm text-muted-foreground">
          Ton CV ne prouve pas {questions.length > 1 ? "ces exigences" : "cette exigence"} de l&apos;offre. Plutôt que de l&apos;inventer, l&apos;agent te
          demande : une réponse « Oui » sera citée dans la lettre comme « Réponse du candidat ».
        </p>
      </div>
      {questions.map((question, index) => (
        <fieldset key={question.prompt} className="flex flex-col gap-2" disabled={busy}>
          <legend className="mb-1 font-medium">{question.prompt}</legend>
          <div className="flex flex-wrap gap-2">
            {CHOICES.map(([choice, label]) => (
              <button
                key={choice}
                type="button"
                aria-pressed={choices[index] === choice}
                onClick={() => setChoices((s) => ({ ...s, [index]: choice }))}
                className="rounded-full border bg-background px-3 py-1.5 text-left text-sm font-medium hover:border-primary disabled:opacity-50 aria-pressed:border-primary aria-pressed:bg-primary aria-pressed:text-primary-foreground"
              >
                {label}
              </button>
            ))}
          </div>
          {choices[index] === "yes" && (
            <>
              <textarea
                aria-label={`Où ? ${question.prompt}`}
                aria-required="true"
                value={details[index] ?? ""}
                onChange={(event) => setDetails((s) => ({ ...s, [index]: event.target.value }))}
                rows={2}
                maxLength={2000}
                className="w-full rounded-md border bg-background px-3 py-2 text-sm"
                placeholder="Dans quel projet ou quelle expérience ? Un fait précis si possible."
                data-lenis-prevent
              />
              {!(details[index] ?? "").trim() && <p className="text-xs text-destructive">Précise le projet ou l&apos;expérience pour envoyer « Oui ».</p>}
            </>
          )}
        </fieldset>
      ))}
      {error && <p className="text-sm text-destructive">{error}</p>}
      <div className="flex flex-wrap items-center gap-3">
        <Button type="button" className="btn-shine" disabled={busy || !allChosen || missingDetail} onClick={() => onSubmit(answers)}>
          {busy ? "Envoi…" : questions.length > 1 ? "Envoyer mes réponses" : "Envoyer ma réponse"}
        </Button>
        <Button type="button" variant="outline" disabled={busy} onClick={skipAll}>
          Rédiger sans répondre
        </Button>
      </div>
    </section>
  );
}
