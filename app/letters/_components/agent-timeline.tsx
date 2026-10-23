"use client";

import type { TimelineStep } from "@/lib/letters/agent-run";

export type AgentPhase = "idle" | "running" | "questions" | "done" | "failed";

const PHASE_LABEL: Record<AgentPhase, string> = {
  idle: "Prêt",
  running: "En cours",
  questions: "Attend ta réponse",
  done: "Terminé",
  failed: "Arrêté",
};

/** Secondes écoulées depuis la première étape (« +12 s »). */
function elapsed(from: string, at: string) {
  const seconds = Math.max(0, Math.round((new Date(at).getTime() - new Date(from).getTime()) / 1000));
  return seconds < 60 ? `+${seconds} s` : `+${Math.floor(seconds / 60)} min ${seconds % 60} s`;
}

/** Étapes de l'agent Cominty en direct : une ligne par étape, mise à jour au fil du flux. */
export function AgentTimeline({ steps, phase }: { steps: TimelineStep[]; phase: AgentPhase }) {
  // Origine des durées : l'horodatage le plus ancien (ceux de Cominty ne suivent pas l'ordre des étapes).
  const first = steps.reduce<string | undefined>((min, step) => (!min || step.at < min ? step.at : min), undefined);
  return (
    <section aria-label="Étapes de l'agent" className="flex flex-col gap-3 rounded-xl border bg-card p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-sm font-semibold">Agent Cominty</h2>
        <span
          className={`rounded-full border px-2.5 py-0.5 text-xs font-medium ${
            phase === "failed" ? "border-destructive text-destructive" : phase === "questions" ? "border-primary text-primary" : "text-muted-foreground"
          }`}
          aria-live="polite"
        >
          {PHASE_LABEL[phase]}
        </span>
      </div>
      <div className="h-1.5 overflow-hidden rounded-full bg-muted" aria-hidden="true">
        {phase === "running" ? (
          <div className="agent-progress h-full w-1/3 rounded-full bg-primary" />
        ) : (
          <div className={`h-full rounded-full ${phase === "failed" ? "bg-destructive" : "bg-primary"}`} style={{ width: phase === "idle" ? "0%" : "100%" }} />
        )}
      </div>
      {steps.length === 0 ? (
        <p className="text-sm text-muted-foreground">{phase === "running" ? "Connexion à l'agent…" : "Aucune étape pour l'instant."}</p>
      ) : (
        <ol className="flex max-h-72 flex-col gap-2 overflow-auto text-sm" data-lenis-prevent aria-live="polite">
          {steps.map((step, index) => {
            // Clé « runId:correlationId » : un nouveau tour de l'agent (réponse, correction) commence quand le runId change.
            const runOf = (key: string) => key.slice(0, key.lastIndexOf(":"));
            const newRound = index > 0 && runOf(step.key) !== runOf(steps[index - 1].key);
            const round = new Set(steps.slice(0, index + 1).map((s) => runOf(s.key))).size;
            return (
              <li key={step.key} className="flex flex-col gap-2" aria-current={step.status === "running" ? "step" : undefined}>
                {newRound && <span className="mt-1 border-t pt-2 text-xs font-semibold tracking-wider text-muted-foreground uppercase">Tour {round} de l&apos;agent</span>}
                <span className="flex items-center gap-2">
                  <StepIcon status={step.status} />
                  <span className={step.status === "running" ? "italic" : step.status === "error" ? "text-destructive" : ""}>{step.label}</span>
                  <span className="ml-auto text-xs text-muted-foreground tabular-nums">{first ? elapsed(first, step.at) : ""}</span>
                </span>
              </li>
            );
          })}
        </ol>
      )}
    </section>
  );
}

function StepIcon({ status }: { status: TimelineStep["status"] }) {
  if (status === "running") {
    return <span aria-hidden="true" className="size-4 shrink-0 animate-spin rounded-full border-2 border-muted border-t-primary motion-reduce:animate-none" />;
  }
  return (
    <svg viewBox="0 0 22 22" className={`size-[18px] shrink-0 ${status === "success" ? "draw-tick" : ""}`} aria-hidden="true">
      <circle cx="11" cy="11" r="9.5" fill="none" stroke="currentColor" strokeOpacity="0.45" strokeWidth="1.5" className={status === "error" ? "text-destructive" : ""} />
      {status === "success" && <path d="M6.5 11.5l3 3 6-6.5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" strokeDasharray="24" />}
      {status === "error" && <path d="M8 8l6 6M14 8l-6 6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" className="text-destructive" />}
    </svg>
  );
}
