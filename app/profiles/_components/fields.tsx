"use client";

import gsap from "gsap";
import { useEffect, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import { useReducedMotion } from "@/components/motion/use-reduced-motion";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";

/** Champ avec libellé, aide et message d'erreur ; data-field sert à y amener l'utilisateur depuis les récapitulatifs. */
export function Field({
  name,
  label,
  error,
  hint,
  warning,
  children,
  className,
}: {
  name: string;
  label: string;
  error?: string;
  hint?: string;
  warning?: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <div data-field={name} className={cn("flex min-w-0 flex-col gap-1.5", className)}>
      <Label htmlFor={fieldId(name)}>{label}</Label>
      {children}
      {hint && !error && <p className="text-xs text-muted-foreground">{hint}</p>}
      {warning && !error && <p className="text-xs text-warning">{warning}</p>}
      {error && (
        <p role="alert" className="text-xs font-medium text-destructive">
          {error}
        </p>
      )}
    </div>
  );
}

export const fieldId = (name: string) => `field-${name.replaceAll(".", "-")}`;

export const selectClassName =
  "h-9 w-full min-w-0 rounded-md border border-input bg-card px-2.5 text-sm text-foreground shadow-xs outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50 aria-invalid:border-destructive";

/** Liste de lignes (une réalisation par ligne). Le texte saisi est gardé tel quel ; seules les lignes non vides sont émises. */
export function LinesInput({
  id,
  value,
  onChange,
  onBlur,
  placeholder,
  invalid,
}: {
  id: string;
  value: string[];
  onChange: (lines: string[]) => void;
  onBlur?: () => void;
  placeholder?: string;
  invalid?: boolean;
}) {
  const [text, setText] = useState(value.join("\n"));
  const [previous, setPrevious] = useState(value);
  const toLines = (raw: string) => raw.split("\n").map((line) => line.trim()).filter(Boolean);

  // Valeur modifiée de l'extérieur (fusion d'un projet, brouillon restauré) : on resynchronise le texte pendant le rendu.
  if (value !== previous) {
    setPrevious(value);
    if (toLines(text).join("\n") !== value.join("\n")) setText(value.join("\n"));
  }

  return (
    <Textarea
      id={id}
      rows={Math.min(8, Math.max(3, value.length + 1))}
      value={text}
      placeholder={placeholder}
      aria-invalid={invalid || undefined}
      data-lenis-prevent
      onChange={(event) => {
        setText(event.target.value);
        onChange(toLines(event.target.value));
      }}
      onBlur={onBlur}
    />
  );
}

/** Saisie en puces : Entrée ou virgule pour ajouter, retour arrière pour retirer la dernière. */
export function ChipsInput({
  id,
  value,
  onChange,
  placeholder,
  invalid,
}: {
  id: string;
  value: string[];
  onChange: (items: string[]) => void;
  placeholder?: string;
  invalid?: boolean;
}) {
  const [draft, setDraft] = useState("");
  const listRef = useRef<HTMLUListElement>(null);
  const reduced = useReducedMotion();
  const previousLength = useRef(value.length);

  useEffect(() => {
    const list = listRef.current;
    if (!reduced && list && value.length > previousLength.current) {
      gsap.from(list.lastElementChild, { scale: 0.85, opacity: 0, duration: 0.2, ease: "back.out(2)" });
    }
    previousLength.current = value.length;
  }, [value.length, reduced]);

  function add(raw: string) {
    const items = raw.split(",").map((item) => item.trim()).filter(Boolean);
    const lower = new Set(value.map((item) => item.toLowerCase()));
    const fresh = items.filter((item) => !lower.has(item.toLowerCase()));
    if (fresh.length) onChange([...value, ...fresh]);
    setDraft("");
  }

  function onKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if ((event.key === "Enter" || event.key === ",") && draft.trim()) {
      event.preventDefault();
      add(draft);
    } else if (event.key === "Enter") {
      event.preventDefault();
    } else if (event.key === "Backspace" && !draft && value.length) {
      onChange(value.slice(0, -1));
    }
  }

  return (
    <div
      className={cn(
        "flex min-w-0 flex-wrap items-center gap-1.5 rounded-md border border-input bg-card p-1.5 focus-within:ring-[3px] focus-within:ring-ring/50",
        invalid && "border-destructive",
      )}
    >
      <ul ref={listRef} className="contents">
        {value.map((item, index) => (
          <li key={`${item}-${index}`} className="inline-flex items-center gap-1 rounded-sm border bg-background px-2 py-0.5 text-sm">
            {item}
            <button
              type="button"
              className="text-muted-foreground hover:text-foreground"
              aria-label={`Retirer ${item}`}
              onClick={() => onChange(value.filter((_, i) => i !== index))}
            >
              ×
            </button>
          </li>
        ))}
      </ul>
      <Input
        id={id}
        value={draft}
        placeholder={value.length ? "" : placeholder}
        onChange={(event) => setDraft(event.target.value)}
        onKeyDown={onKeyDown}
        onBlur={() => draft.trim() && add(draft)}
        className="h-7 min-w-32 flex-1 border-0 bg-transparent px-1 shadow-none focus-visible:ring-0 dark:bg-transparent"
      />
    </div>
  );
}
