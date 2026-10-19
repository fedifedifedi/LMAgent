import { cn } from "@/lib/utils";

/** Fil d'étapes (type « stepper ») : étapes faites, en cours, à venir. */
export function Stepper({ steps, current }: { steps: string[]; current: number }) {
  return (
    <ol className="flex flex-wrap items-center gap-y-2 text-sm" aria-label="Étapes">
      {steps.map((label, index) => {
        const state = index < current ? "done" : index === current ? "current" : "todo";
        return (
          <li key={label} className="flex items-center" aria-current={state === "current" ? "step" : undefined}>
            {index > 0 && <span aria-hidden="true" className={cn("mx-3 h-px w-10", index <= current ? "bg-primary" : "bg-border")} />}
            <span className={cn("flex items-center gap-2", state === "todo" ? "text-muted-foreground" : "font-medium")}>
              <span
                className={cn(
                  "grid size-6 place-items-center rounded-full border text-xs font-bold",
                  state === "done" && "border-transparent bg-[#1f7a4d] text-white",
                  state === "current" && "border-primary bg-primary text-primary-foreground",
                )}
              >
                {state === "done" ? "✓" : index + 1}
              </span>
              {label}
            </span>
          </li>
        );
      })}
    </ol>
  );
}
