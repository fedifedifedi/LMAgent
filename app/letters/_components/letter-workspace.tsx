"use client";

import { useGSAP } from "@gsap/react";
import Link from "next/link";
import gsap from "gsap";
import { SplitText } from "gsap/SplitText";
import { useEffect, useRef, useState } from "react";
import {
  answerAgentAction,
  cancelAgentRunAction,
  getLetterViewAction,
  revertLetterAction,
  saveLetterEditsAction,
  setLetterTemplateAction,
  startAgentRunAction,
} from "@/app/letters/actions";
import { AgentQuestions, type QuestionAnswer } from "@/app/letters/_components/agent-questions";
import { AgentTimeline, type AgentPhase } from "@/app/letters/_components/agent-timeline";
import { DeleteLetter } from "@/app/letters/_components/delete-letter";
import { LetterEditor } from "@/app/letters/_components/letter-editor";
import { LetterDocument } from "@/components/letter/letter-document";
import { SheetFit } from "@/components/letter/sheet-fit";
import { editedCount, type LetterEdits } from "@/lib/letters/stored";
import { LETTER_TEMPLATES, type LetterTemplate } from "@/lib/letters/templates";
import { useReducedMotion } from "@/components/motion/use-reduced-motion";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { letterWordCount } from "@/lib/agent/letter-checks";
import type { ComintyQuestion } from "@/lib/cominty/schemas";
import type { AgentStreamEvent, TimelineStep } from "@/lib/letters/agent-run";
import type { LetterView } from "@/lib/letters/view";

gsap.registerPlugin(useGSAP, SplitText);

/** Libellés des appels dans « Détails de la génération » (lettres Cominty et anciennes lettres du pipeline). */
const STEP_LABELS: Record<string, string> = {
  AGENT_LETTER: "Tour de l'agent Cominty",
  ANALYZE_OFFER: "Analyse de l'offre",
  MATCH_PROFILE: "Correspondance avec le profil",
  WRITE_LETTER: "Rédaction",
  CRITIQUE: "Relecture critique",
  REWRITE: "Réécriture",
};

/** Reconnexions automatiques au flux avant d'afficher « Reprendre » (l'agent continue côté Cominty). */
const MAX_RECONNECTS = 4;

function initialPhase(view: LetterView): AgentPhase {
  if (view.agent.activeRunId) return "running";
  if (view.status === "NEEDS_INPUT" && view.agent.questions) return "questions";
  if (view.status === "FAILED") return "failed";
  return view.letter ? "done" : "idle";
}

/** Lit un flux text/event-stream : un objet par bloc « event / data ». */
async function* readServerEvents(body: ReadableStream<Uint8Array>): AsyncGenerator<AgentStreamEvent> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    let end: number;
    while ((end = buffer.indexOf("\n\n")) >= 0) {
      const block = buffer.slice(0, end);
      buffer = buffer.slice(end + 2);
      const data = block
        .split("\n")
        .filter((line) => line.startsWith("data:"))
        .map((line) => line.slice(5).trim())
        .join("");
      if (data) yield JSON.parse(data) as AgentStreamEvent;
    }
  }
}

export function LetterWorkspace({ initial }: { initial: LetterView }) {
  const [view, setView] = useState(initial);
  const [phase, setPhase] = useState<AgentPhase>(() => initialPhase(initial));
  const [steps, setSteps] = useState<TimelineStep[]>(initial.agent.timeline);
  const [questions, setQuestions] = useState<ComintyQuestion[] | null>(initial.agent.questions);
  const [error, setError] = useState<string | null>(initial.status === "FAILED" ? (initial.error ?? "La génération s'est arrêtée.") : null);
  const [answering, setAnswering] = useState(false);
  const [answerError, setAnswerError] = useState<string | null>(null);
  const [showSources, setShowSources] = useState(false);
  const [highlight, setHighlight] = useState(false);
  const [revealLetter, setRevealLetter] = useState(false);
  const streamAbort = useRef<AbortController | null>(null);
  const sheetRef = useRef<HTMLDivElement>(null);
  const reduced = useReducedMotion();
  const running = phase === "running";

  function upsertStep(step: TimelineStep) {
    setSteps((current) => {
      const index = current.findIndex((s) => s.key === step.key);
      if (index < 0) return [...current, step];
      const next = [...current];
      next[index] = { ...step, label: current[index].label, at: current[index].at };
      return next;
    });
  }

  async function refresh(reveal = false) {
    const result = await getLetterViewAction(view.id);
    if ("view" in result) {
      if (reveal && result.view.letter) setRevealLetter(true);
      setView(result.view);
    }
  }

  /** Suit une exécution de l'agent en direct ; se reconnecte si le flux coupe (l'agent, lui, continue). */
  async function follow(runId: string) {
    streamAbort.current?.abort();
    const controller = new AbortController();
    streamAbort.current = controller;
    setPhase("running");
    setError(null);
    let current = runId;
    let finished = false;
    for (let attempt = 0; attempt <= MAX_RECONNECTS && !finished; attempt++) {
      if (attempt > 0) await new Promise((resolve) => setTimeout(resolve, 1500 * attempt));
      try {
        const response = await fetch(`/letters/${view.id}/agent?run=${encodeURIComponent(current)}`, { signal: controller.signal, cache: "no-store" });
        if (!response.ok || !response.body) continue;
        for await (const event of readServerEvents(response.body)) {
          if (event.type === "step") upsertStep(event.step);
          else if (event.type === "run") current = event.runId;
          else if (event.type === "questions") {
            finished = true;
            setQuestions(event.questions);
            setPhase("questions");
            await refresh();
          } else if (event.type === "done") {
            finished = true;
            setQuestions(null);
            await refresh(true);
            setPhase("done");
          } else if (event.type === "failed") {
            finished = true;
            setError(event.error);
            setPhase("failed");
            await refresh();
          }
        }
      } catch {
        if (controller.signal.aborted) return;
      }
    }
    if (!finished && !controller.signal.aborted) {
      setPhase("failed");
      setError("La connexion à l'agent a été perdue. Clique sur Reprendre : l'agent a continué de son côté.");
    }
  }

  async function start() {
    setPhase("running");
    setError(null);
    const result = await startAgentRunAction(view.id);
    if ("error" in result) {
      setError(result.error);
      setPhase("failed");
      return;
    }
    await follow(result.runId);
  }

  /** Reprendre : suit l'exécution encore en cours s'il y en a une, sinon relance l'agent dans une nouvelle conversation. */
  async function resume() {
    const latest = await getLetterViewAction(view.id);
    const activeRunId = "view" in latest ? latest.view.agent.activeRunId : null;
    if (activeRunId) await follow(activeRunId);
    else await start();
  }

  async function answer(answers: QuestionAnswer[]) {
    setAnswering(true);
    setAnswerError(null);
    try {
      const result = await answerAgentAction(view.id, answers);
      if ("error" in result) {
        setAnswerError(result.error);
        return;
      }
      setQuestions(null);
      void follow(result.runId);
    } finally {
      setAnswering(false);
    }
  }

  async function cancel() {
    streamAbort.current?.abort();
    const result = await cancelAgentRunAction(view.id);
    if ("view" in result) {
      setView(result.view);
      setError(result.view.error ?? "Génération annulée.");
    }
    setPhase("failed");
  }

  // Démarrage ou reprise automatique au montage. Différé d'un tour : en mode strict, React monte deux fois ;
  // le premier minuteur est annulé par le nettoyage, seul le second part (startAgentRun est de toute façon idempotent).
  useEffect(() => {
    const timer = window.setTimeout(() => {
      if (initial.agent.activeRunId) void follow(initial.agent.activeRunId);
      else if (initialPhase(initial) === "idle") void start();
    }, 0);
    return () => {
      window.clearTimeout(timer);
      streamAbort.current?.abort();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- une seule fois au montage
  }, []);

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

  const [editing, setEditing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [exporting, setExporting] = useState(false);
  const [exportNotice, setExportNotice] = useState<{ tone: "info" | "warning" | "error"; message: string } | null>(null);
  const edited = view.letter ? editedCount(view.letter) : 0;

  async function withView(run: () => Promise<{ view: LetterView } | { error: string }>, onDone?: () => void) {
    setBusy(true);
    setActionError(null);
    try {
      const result = await run();
      if ("error" in result) setActionError(result.error);
      else {
        setView(result.view);
        onDone?.();
      }
    } finally {
      setBusy(false);
    }
  }

  const chooseTemplate = (template: LetterTemplate) => void withView(() => setLetterTemplateAction(view.id, template));
  const saveEdits = (edits: LetterEdits) => void withView(() => saveLetterEditsAction(view.id, edits), () => setEditing(false));
  const revert = () => void withView(() => revertLetterAction(view.id));

  async function exportPdf() {
    setExporting(true);
    setExportNotice(null);
    try {
      const response = await fetch(`/letters/${view.id}/pdf`);
      if (!response.ok) {
        const body = (await response.json().catch(() => null)) as { error?: string } | null;
        setExportNotice({ tone: "error", message: body?.error ?? "L'export PDF a échoué." });
        return;
      }
      const blob = await response.blob();
      const name = decodeURIComponent(response.headers.get("x-letter-file-name") ?? "Lettre.pdf");
      const link = document.createElement("a");
      link.href = URL.createObjectURL(blob);
      link.download = name;
      link.click();
      setTimeout(() => URL.revokeObjectURL(link.href), 10_000);

      const pt = response.headers.get("x-letter-font-pt");
      if (response.headers.get("x-letter-overflow") === "1") {
        setExportNotice({ tone: "warning", message: `La lettre dépasse une page même avec le texte réduit à ${pt} pt : raccourcis-la (mode « Modifier le texte ») ou choisis la mise en page Compact.` });
      } else if (pt && Number(pt) < LETTER_TEMPLATES[view.template].basePt) {
        setExportNotice({ tone: "info", message: `PDF téléchargé : texte réduit à ${pt} pt pour tenir sur une page.` });
      } else {
        setExportNotice({ tone: "info", message: `PDF téléchargé : ${name}` });
      }
    } catch {
      setExportNotice({ tone: "error", message: "L'export PDF a échoué : vérifie que l'application tourne toujours." });
    } finally {
      setExporting(false);
    }
  }

  const { analysis, match, insights } = view;
  const totals = view.usage.reduce((sum, u) => ({ input: sum.input + u.inputTokens, output: sum.output + u.outputTokens, cost: sum.cost + (u.costUsd ?? 0) }), { input: 0, output: 0, cost: 0 });
  const retries = view.usage.reduce((sum, u) => sum + Math.max(0, u.attempts - 1), 0);
  const costLabel = totals.cost > 0 ? ` · ${totals.cost.toLocaleString("fr-FR", { style: "currency", currency: "USD", maximumFractionDigits: 3 })}` : "";
  const showTimeline = steps.length > 0 || phase !== "done";

  return (
    <>
    <header className="-mt-4 flex flex-wrap items-start justify-between gap-4">
      <div className="flex flex-col gap-1">
        <h1 className="font-heading text-4xl">{analysis?.jobTitle ?? "Nouvelle lettre"}</h1>
        {analysis?.company && <p className="text-muted-foreground">{analysis.company}</p>}
      </div>
      <div className="flex flex-wrap items-center gap-2">
        {running && (
          <Button type="button" variant="outline" size="sm" onClick={() => void cancel()}>
            Arrêter l&apos;agent
          </Button>
        )}
        {/* Pas de suppression pendant que l'agent tourne : il écrirait dans une lettre supprimée. */}
        <DeleteLetter id={view.id} title={analysis?.jobTitle ?? "Nouvelle lettre"} disabled={running} />
      </div>
    </header>

    {showTimeline && <AgentTimeline steps={steps} phase={phase} replay={view.agent.replay} />}

    {phase === "questions" && questions && <AgentQuestions questions={questions} busy={answering} error={answerError} onSubmit={(answers) => void answer(answers)} />}

    <div className="grid grid-cols-1 gap-6 lg:grid-cols-[minmax(0,0.85fr)_minmax(0,1.3fr)]">
      <div className="flex flex-col gap-6">
        <Card>
          <CardHeader>
            <CardTitle className="font-heading text-2xl font-normal">Offre analysée</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-3 text-sm">
            {!analysis && <p className="text-muted-foreground">{running ? "L'agent lit l'offre et ton profil…" : "En attente de l'analyse."}</p>}
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

        {insights && (
          <Card>
            <CardHeader>
              <CardTitle className="font-heading text-2xl font-normal">Adéquation avec l&apos;offre</CardTitle>
            </CardHeader>
            <CardContent className="flex flex-col gap-4 text-sm">
              <div className="flex items-center gap-4">
                <div
                  role="meter"
                  aria-valuenow={insights.score}
                  aria-valuemin={0}
                  aria-valuemax={100}
                  aria-label="Score d'adéquation"
                  className="grid size-20 shrink-0 place-items-center rounded-full"
                  style={{ background: `conic-gradient(var(--primary) ${insights.score * 3.6}deg, var(--muted) 0)` }}
                >
                  <span className="grid size-[3.9rem] place-items-center rounded-full bg-card font-heading text-xl tabular-nums">{insights.score}</span>
                </div>
                <span className="text-muted-foreground">Score sur 100, calculé par l&apos;agent à partir de ton profil validé.</span>
              </div>
              <ul className="list-disc pl-5">
                {insights.scoreReasons.map((reason) => (
                  <li key={reason}>{reason}</li>
                ))}
              </ul>
            </CardContent>
          </Card>
        )}

        {insights && insights.cvAdjustments.length > 0 && (
          <Card>
            <CardHeader>
              <CardTitle className="font-heading text-2xl font-normal">Ajustements du CV</CardTitle>
            </CardHeader>
            <CardContent className="flex flex-col gap-3 text-sm">
              <ol className="flex flex-col gap-3">
                {insights.cvAdjustments.map((adjustment) => (
                  <li key={`${adjustment.section}-${adjustment.change}`} className="flex flex-col gap-0.5 border-l-2 border-primary/50 pl-3">
                    <span className="text-xs font-semibold tracking-wider text-muted-foreground uppercase">{adjustment.section}</span>
                    <span className="font-medium">{adjustment.change}</span>
                    <span className="text-muted-foreground">{adjustment.reason}</span>
                  </li>
                ))}
              </ol>
              <p className="text-xs text-muted-foreground">Suggestions seulement : ton CV d&apos;origine n&apos;est jamais modifié.</p>
            </CardContent>
          </Card>
        )}

        <Card>
          <CardContent className="flex flex-col gap-4 text-sm">
            <details>
              <summary className="cursor-pointer text-muted-foreground">Détails de la génération</summary>
              <table className="mt-2 w-full tabular-nums">
                <tbody>
                  {view.usage.map((u, i) => (
                    <tr key={i} className="border-b border-dotted">
                      <td className="py-1">
                        {STEP_LABELS[u.step] ?? u.step}
                        {u.success ? "" : " (échec)"}
                      </td>
                      <td className="py-1 text-right">
                        {(u.inputTokens + u.outputTokens).toLocaleString("fr-FR")} tokens
                        {u.costUsd ? ` · ${u.costUsd.toLocaleString("fr-FR", { style: "currency", currency: "USD", maximumFractionDigits: 3 })}` : ""}
                      </td>
                    </tr>
                  ))}
                  <tr className="font-semibold">
                    <td className="py-1">
                      Total · {view.usage[0]?.model ?? "—"} · {retries} relance{retries > 1 ? "s" : ""}
                    </td>
                    <td className="py-1 text-right">
                      {(totals.input + totals.output).toLocaleString("fr-FR")} tokens{view.usage.some((u) => u.estimated) ? " (estimés)" : ""}
                      {costLabel}
                    </td>
                  </tr>
                </tbody>
              </table>
            </details>
          </CardContent>
        </Card>
      </div>

      <div className="flex min-w-0 flex-col gap-3">
        {phase === "failed" && error && (
          <Alert variant="destructive">
            <AlertTitle>La génération s&apos;est arrêtée</AlertTitle>
            <AlertDescription>
              <p>{error}</p>
              <div className="mt-2 flex flex-wrap items-center gap-3">
                <Button type="button" size="sm" onClick={() => void resume()}>
                  Reprendre
                </Button>
                {error.includes("Code d'accès") && (
                  <Link href="/acces" className="text-sm underline underline-offset-2">
                    Saisir un code d&apos;accès
                  </Link>
                )}
              </div>
            </AlertDescription>
          </Alert>
        )}

        {/* Barre d'outils unique : mise en page (contrôle segmenté) et options d'affichage. */}
        <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl border bg-card px-2.5 py-2">
          <div role="group" aria-label="Mise en page" className="inline-flex overflow-hidden rounded-md border text-sm">
            {(Object.keys(LETTER_TEMPLATES) as LetterTemplate[]).map((key) => (
              <button
                key={key}
                type="button"
                aria-pressed={view.template === key}
                disabled={!view.letter || busy || revealLetter}
                onClick={() => chooseTemplate(key)}
                title={LETTER_TEMPLATES[key].description}
                className="px-3 py-1.5 font-medium disabled:opacity-50 aria-pressed:bg-primary aria-pressed:text-primary-foreground"
              >
                {LETTER_TEMPLATES[key].label}
              </button>
            ))}
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Toggle pressed={showSources} onChange={setShowSources} disabled={!view.letter || revealLetter || editing}>
              Sources
            </Toggle>
            <Toggle pressed={highlight} onChange={setHighlight} disabled={!view.letter || revealLetter || editing}>
              Surligner
            </Toggle>
            <Toggle pressed={editing} onChange={setEditing} disabled={!view.letter || revealLetter || busy || running}>
              Modifier le texte
            </Toggle>
          </div>
        </div>
        <span className="-mt-1 text-xs text-muted-foreground">Sources et surlignage : affichage seulement, jamais dans le PDF.</span>

        {view.letter && edited > 0 && !editing && (
          <p className="flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
            {edited} phrase{edited > 1 ? "s" : ""} modifiée{edited > 1 ? "s" : ""} par toi (sans source, marquée{edited > 1 ? "s" : ""} ✎ dans les sources).
            {view.canRevert && (
              <button type="button" className="underline underline-offset-2" disabled={busy} onClick={revert}>
                Revenir à la version générée
              </button>
            )}
          </p>
        )}

        {editing && view.letter && (
          <LetterEditor letter={view.letter} saving={busy} error={actionError} onCancel={() => setEditing(false)} onSave={saveEdits} />
        )}

        <div className="max-h-[52rem] overflow-auto rounded-lg bg-muted p-3 sm:p-5" data-lenis-prevent>
          {view.letter ? (
            <SheetFit>
              <div ref={sheetRef}>
                <LetterDocument
                  letter={view.letter}
                  header={view.header}
                  template={view.template}
                  sources={view.sources}
                  showSources={showSources}
                  highlightTerms={highlight ? view.highlightTerms : []}
                />
              </div>
            </SheetFit>
          ) : (
            <div className="mx-auto flex aspect-[210/297] w-full max-w-[210mm] items-center justify-center bg-sheet p-8 text-center font-letter text-sheet-foreground/60 shadow-sm">
              {running ? "La lettre s'écrit…" : phase === "questions" ? "Réponds à la question de l'agent pour qu'il écrive la lettre." : "La lettre apparaîtra ici."}
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

        {exportNotice && (
          <Alert variant={exportNotice.tone === "error" ? "destructive" : "default"} aria-live="polite">
            <AlertDescription>{exportNotice.message}</AlertDescription>
          </Alert>
        )}

        {/* Barre d'action fixe (type « floating dock ») : l'export reste toujours à portée. */}
        <div className="sticky bottom-3 z-10 flex flex-wrap items-center justify-between gap-3 rounded-xl border bg-card/90 px-4 py-2.5 shadow-lg backdrop-blur">
          <span className="text-sm text-muted-foreground tabular-nums">
            {view.letter
              ? `Une page A4 · ${letterWordCount(view.letter)} mots · ${new Set(view.letter.paragraphs.flatMap((p) => p.sentences.flatMap((s) => s.sourceIds))).size} sources · ${(totals.input + totals.output).toLocaleString("fr-FR")} tokens${costLabel}`
              : running
                ? "L'agent travaille…"
                : phase === "questions"
                  ? "L'agent attend ta réponse."
                  : "La lettre n'est pas encore prête."}
          </span>
          <Button type="button" className="btn-shine" disabled={!view.letter || exporting || editing || running} onClick={exportPdf}>
            {exporting ? "Préparation du PDF…" : "Exporter en PDF"}
          </Button>
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
