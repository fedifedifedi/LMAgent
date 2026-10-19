"use client";

import { useGSAP } from "@gsap/react";
import gsap from "gsap";
import { SplitText } from "gsap/SplitText";
import { useEffect, useRef, useState } from "react";
import { runLetterStepAction } from "@/app/letters/actions";
import { DeleteLetter } from "@/app/letters/_components/delete-letter";
import { LetterSheet } from "@/components/letter/letter-sheet";
import { useReducedMotion } from "@/components/motion/use-reduced-motion";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { letterWordCount } from "@/lib/agent/letter-checks";
import type { LetterStep } from "@/lib/letters/pipeline";
import type { LetterView } from "@/lib/letters/view";

gsap.registerPlugin(useGSAP, SplitText);

const STEPS: Array<{ key: LetterStep; label: string; llm: string }> = [
  { key: "analyze", label: "Analyse de l'offre", llm: "ANALYZE_OFFER" },
  { key: "match", label: "Correspondance avec le profil", llm: "MATCH_PROFILE" },
  { key: "write", label: "Rédaction", llm: "WRITE_LETTER" },
  { key: "critique", label: "Relecture critique", llm: "CRITIQUE" },
  { key: "rewrite", label: "Réécriture", llm: "REWRITE" },
];

type StepState = "done" | "running" | "pending" | "failed" | "skipped";

function stepStates(view: LetterView, running: LetterStep | null): Record<LetterStep, { state: StepState; detail: string }> {
  const rewritten = view.usage.some((u) => u.step === "REWRITE" && u.success);
  const requirements = view.match?.requirements ?? [];
  const found = requirements.filter((r) => r.status !== "missing").length;
  const done: Record<LetterStep, boolean> = {
    analyze: !!view.analysis,
    match: !!view.match,
    write: view.hasDraft,
    critique: !!view.critique,
    rewrite: rewritten,
  };
  const details: Record<LetterStep, string> = {
    analyze: view.analysis ? `${view.analysis.requirements.length} compétences repérées` : "",
    match: view.match ? `${found} sur ${requirements.length} dans ton profil` : "",
    write: view.hasDraft ? "première version" : "",
    critique: view.critique ? (view.critique.verdict === "ok" && view.checks.length === 0 ? "rien à corriger" : `${view.critique.issues.length + view.checks.length} point(s) à corriger`) : "",
    rewrite: rewritten ? (view.letter ? `${letterWordCount(view.letter)} mots` : "fait") : "",
  };
  return Object.fromEntries(
    STEPS.map(({ key }) => {
      let state: StepState = done[key] ? "done" : "pending";
      if (key === "rewrite" && !rewritten && view.letter) state = "skipped";
      if (running === key) state = "running";
      if (view.status === "FAILED" && view.next === key && running !== key) state = "failed";
      const detail = state === "running" ? "en cours…" : state === "skipped" ? "pas nécessaire" : state === "failed" ? "échec" : details[key];
      return [key, { state, detail }];
    }),
  ) as Record<LetterStep, { state: StepState; detail: string }>;
}

export function LetterWorkspace({ initial }: { initial: LetterView }) {
  const [view, setView] = useState(initial);
  const [running, setRunning] = useState<LetterStep | null>(null);
  const [error, setError] = useState<{ message: string; retryAfterSeconds?: number } | null>(initial.status === "FAILED" ? { message: initial.error ?? "La génération s'est arrêtée." } : null);
  const [showSources, setShowSources] = useState(false);
  const [highlight, setHighlight] = useState(false);
  const [revealLetter, setRevealLetter] = useState(false);
  const started = useRef(false);
  const sheetRef = useRef<HTMLDivElement>(null);
  const barRef = useRef<HTMLDivElement>(null);
  const reduced = useReducedMotion();

  async function runAll(from: LetterView) {
    setError(null);
    let current = from;
    while (current.next) {
      const step = current.next;
      setRunning(step);
      const result = await runLetterStepAction(current.id);
      if (!("view" in result)) {
        setError({ message: result.error });
        break;
      }
      if (!current.letter && result.view.letter) setRevealLetter(true);
      current = result.view;
      setView(current);
      if (result.error) {
        setError({ message: result.error, retryAfterSeconds: result.retryAfterSeconds });
        break;
      }
    }
    setRunning(null);
  }

  // Démarrage automatique (une seule fois, même en mode strict de React).
  useEffect(() => {
    if (started.current || !initial.next || initial.status === "FAILED") return;
    started.current = true;
    void runAll(initial);
  }, [initial]);

  const states = stepStates(view, running);
  const doneCount = STEPS.filter(({ key }) => ["done", "skipped"].includes(states[key].state)).length;

  // Barre de progression du pipeline (GSAP) : avance à chaque étape terminée.
  useGSAP(
    () => {
      if (!barRef.current) return;
      const scaleX = doneCount / STEPS.length;
      if (reduced) gsap.set(barRef.current, { scaleX });
      else gsap.to(barRef.current, { scaleX, duration: 0.5, ease: "power2.out" });
    },
    { dependencies: [doneCount, reduced] },
  );

  // Apparition de la lettre ligne par ligne (SplitText), seulement quand elle vient d'être générée.
  useGSAP(
    () => {
      const root = sheetRef.current;
      if (!revealLetter || reduced || !root) return;
      const split = new SplitText(root.querySelectorAll("p"), { type: "lines" });
      const timeline = gsap.from(split.lines, {
        opacity: 0,
        y: 4,
        filter: "blur(3px)",
        duration: 0.45,
        stagger: 0.05,
        ease: "power1.out",
        onComplete: () => {
          split.revert();
          setRevealLetter(false);
        },
      });
      // Si les images ne défilent pas (onglet en arrière-plan), on termine l'animation : la lettre ne reste jamais masquée.
      const safety = window.setTimeout(() => timeline.progress(1), (timeline.duration() + 1) * 1000);
      return () => {
        window.clearTimeout(safety);
        timeline.kill();
        split.revert();
      };
    },
    { dependencies: [revealLetter, reduced], scope: sheetRef },
  );

  const { analysis, match } = view;
  const totals = view.usage.reduce((sum, u) => ({ input: sum.input + u.inputTokens, output: sum.output + u.outputTokens }), { input: 0, output: 0 });
  const retries = view.usage.reduce((sum, u) => sum + Math.max(0, u.attempts - 1), 0);

  return (
    <>
    <header className="-mt-4 flex flex-wrap items-start justify-between gap-4">
      <div className="flex flex-col gap-1">
        <h1 className="font-heading text-4xl">{analysis?.jobTitle ?? "Nouvelle lettre"}</h1>
        {analysis?.company && <p className="text-muted-foreground">{analysis.company}</p>}
      </div>
      {/* Pas de suppression pendant qu'une étape tourne : elle écrirait dans une lettre supprimée. */}
      <DeleteLetter id={view.id} title={analysis?.jobTitle ?? "Nouvelle lettre"} disabled={running !== null} />
    </header>
    <div className="grid grid-cols-1 gap-6 lg:grid-cols-[minmax(0,0.85fr)_minmax(0,1.3fr)]">
      <div className="flex flex-col gap-6">
        <Card>
          <CardHeader>
            <CardTitle className="font-heading text-2xl font-normal">Offre analysée</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-3 text-sm">
            {!analysis && <p className="text-muted-foreground">{running === "analyze" ? "Lecture de l'offre…" : "En attente de l'analyse."}</p>}
            {analysis && (
              <>
                <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-3 gap-y-1">
                  <dt className="text-muted-foreground">Poste</dt>
                  <dd className="font-medium">{analysis.jobTitle}</dd>
                  {analysis.company && (
                    <>
                      <dt className="text-muted-foreground">Entreprise</dt>
                      <dd className="font-medium">{analysis.company}</dd>
                    </>
                  )}
                  {analysis.location && (
                    <>
                      <dt className="text-muted-foreground">Lieu</dt>
                      <dd>{analysis.location}</dd>
                    </>
                  )}
                  {(analysis.contractType || analysis.duration) && (
                    <>
                      <dt className="text-muted-foreground">Contrat</dt>
                      <dd>{[analysis.contractType, analysis.duration, analysis.startDate].filter(Boolean).join(" · ")}</dd>
                    </>
                  )}
                  {analysis.contact && (
                    <>
                      <dt className="text-muted-foreground">Contact</dt>
                      <dd>{[analysis.contact.name, analysis.contact.role].filter(Boolean).join(", ")}</dd>
                    </>
                  )}
                  <dt className="text-muted-foreground">Langue</dt>
                  <dd>{analysis.language === "fr" ? "Français" : "Anglais"}</dd>
                </dl>
                <div className="flex flex-col gap-1.5">
                  <span className="text-xs font-semibold tracking-wider text-muted-foreground uppercase">Compétences demandées</span>
                  <ul className="flex flex-wrap gap-1.5">
                    {analysis.requirements.map((requirement) => {
                      const status = match?.requirements.find((r) => r.name === requirement.name)?.status;
                      return (
                        <li
                          key={requirement.name}
                          className={`rounded-sm border px-2 py-0.5 ${status === "missing" ? "border-dashed text-muted-foreground" : "bg-background"}`}
                          title={requirement.importance === "required" ? "Exigé" : "Apprécié"}
                        >
                          {status === "matched" ? "✓ " : status === "partial" ? "≈ " : ""}
                          {requirement.name}
                          {status === "missing" ? " · absente du profil" : ""}
                        </li>
                      );
                    })}
                  </ul>
                </div>
              </>
            )}
            <details className="text-sm">
              <summary className="cursor-pointer text-muted-foreground">Voir le texte de l&apos;offre{view.offerUrl ? " récupéré" : ""}</summary>
              {view.offerUrl && (
                <a href={view.offerUrl} target="_blank" rel="noreferrer" className="mt-2 block break-all underline underline-offset-2">
                  {view.offerUrl}
                </a>
              )}
              <pre className="mt-2 max-h-72 overflow-auto rounded-md bg-muted p-3 text-xs whitespace-pre-wrap" data-lenis-prevent>
                {view.offerText}
              </pre>
            </details>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="font-heading text-2xl font-normal">Étapes de l&apos;agent</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-4 text-sm">
            <div className="h-1 overflow-hidden rounded-full bg-muted" aria-hidden="true">
              <div ref={barRef} className="h-full origin-left bg-primary" style={{ transform: `scaleX(${doneCount / STEPS.length})` }} />
            </div>
            <ol className="flex flex-col gap-2.5">
              {STEPS.map(({ key, label }, index) => {
                const { state, detail } = states[key];
                return (
                  <li key={key} className="grid grid-cols-[22px_minmax(0,1fr)_auto] items-center gap-3" aria-current={state === "running" ? "step" : undefined}>
                    <StepIcon state={state} />
                    <span className={state === "running" ? "italic" : state === "pending" ? "text-muted-foreground" : ""}>
                      {index + 1}. {label}
                    </span>
                    <span className={`text-xs tabular-nums ${state === "failed" ? "text-destructive" : "text-muted-foreground"}`}>{detail}</span>
                  </li>
                );
              })}
            </ol>
            <details className="border-t pt-3">
              <summary className="cursor-pointer text-muted-foreground">Détails de la génération</summary>
              <table className="mt-2 w-full tabular-nums">
                <tbody>
                  {view.usage.map((u, i) => (
                    <tr key={i} className="border-b border-dotted">
                      <td className="py-1">{STEPS.find((s) => s.llm === u.step)?.label ?? u.step}{u.success ? "" : " (échec)"}</td>
                      <td className="py-1 text-right">{(u.inputTokens + u.outputTokens).toLocaleString("fr-FR")} tokens</td>
                    </tr>
                  ))}
                  <tr className="font-semibold">
                    <td className="py-1">
                      Total · {view.usage[0]?.model ?? "—"} · {retries} relance{retries > 1 ? "s" : ""}
                    </td>
                    <td className="py-1 text-right">
                      {(totals.input + totals.output).toLocaleString("fr-FR")} tokens{view.usage.some((u) => u.estimated) ? " (estimés)" : ""}
                    </td>
                  </tr>
                </tbody>
              </table>
            </details>
          </CardContent>
        </Card>
      </div>

      <div className="flex min-w-0 flex-col gap-3">
        {error && (
          <Alert variant="destructive">
            <AlertTitle>La génération s&apos;est arrêtée</AlertTitle>
            <AlertDescription>
              <p>{error.message}</p>
              <p className="mt-1 text-xs">Les étapes déjà faites sont conservées : la reprise repart de l&apos;étape en échec.</p>
              <Button type="button" size="sm" className="mt-2" disabled={running !== null} onClick={() => void runAll(view)}>
                Reprendre
              </Button>
            </AlertDescription>
          </Alert>
        )}

        <div className="flex flex-wrap items-center gap-2">
          <Toggle pressed={showSources} onChange={setShowSources} disabled={!view.letter || revealLetter}>
            Voir les sources
          </Toggle>
          <Toggle pressed={highlight} onChange={setHighlight} disabled={!view.letter || revealLetter}>
            Surligner les compétences de l&apos;offre
          </Toggle>
          <span className="text-xs text-muted-foreground">Affichage seulement : jamais dans le PDF.</span>
        </div>

        <div className="max-h-[52rem] overflow-auto rounded-lg bg-muted p-3 sm:p-5" data-lenis-prevent>
          {view.letter ? (
            <div ref={sheetRef}>
              <LetterSheet letter={view.letter} header={view.header} sources={view.sources} showSources={showSources} highlightTerms={highlight ? view.highlightTerms : []} />
            </div>
          ) : (
            <div className="mx-auto flex aspect-[210/297] w-full max-w-[210mm] items-center justify-center bg-sheet p-8 text-center font-letter text-sheet-foreground/60 shadow-sm">
              {running ? "La lettre s'écrit…" : "La lettre apparaîtra ici."}
            </div>
          )}
        </div>

        {view.letter && view.checks.length > 0 && (
          <Alert>
            <AlertTitle>Points à vérifier</AlertTitle>
            <AlertDescription>
              <ul className="list-disc pl-5">
                {view.checks.map((check) => (
                  <li key={check.message}>{check.message}</li>
                ))}
              </ul>
            </AlertDescription>
          </Alert>
        )}

        <div className="flex flex-wrap items-center gap-3">
          <Button type="button" disabled>
            Exporter en PDF
          </Button>
          <span className="text-sm text-muted-foreground">L&apos;export PDF arrive à la prochaine étape.</span>
        </div>
      </div>
    </div>
    </>
  );
}

function Toggle({ pressed, onChange, disabled, children }: { pressed: boolean; onChange: (value: boolean) => void; disabled?: boolean; children: React.ReactNode }) {
  return (
    <button
      type="button"
      aria-pressed={pressed}
      disabled={disabled}
      onClick={() => onChange(!pressed)}
      className="rounded-full border bg-card px-3 py-1 text-sm font-medium text-foreground disabled:opacity-50 aria-pressed:border-primary aria-pressed:bg-primary aria-pressed:text-primary-foreground"
    >
      {children}
    </button>
  );
}

function StepIcon({ state }: { state: StepState }) {
  if (state === "running") {
    return <span aria-hidden="true" className="size-[18px] animate-spin rounded-full border-2 border-muted border-t-primary motion-reduce:animate-none" />;
  }
  return (
    <svg viewBox="0 0 22 22" className={`size-[22px] ${state === "done" ? "draw-tick" : ""}`} aria-hidden="true">
      <circle cx="11" cy="11" r="9.5" fill="none" stroke="currentColor" strokeOpacity={state === "pending" ? 0.3 : 0.45} strokeWidth="1.5" className={state === "failed" ? "text-destructive" : ""} />
      {state === "done" && <path d="M6.5 11.5l3 3 6-6.5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" strokeDasharray="24" />}
      {state === "skipped" && <path d="M7 11h8" stroke="currentColor" strokeOpacity="0.5" strokeWidth="2" strokeLinecap="round" />}
      {state === "failed" && <path d="M8 8l6 6M14 8l-6 6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" className="text-destructive" />}
    </svg>
  );
}
