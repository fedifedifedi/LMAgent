import { Fragment, type ReactNode } from "react";
import type { LetterContent } from "@/lib/agent/schemas";
import type { LetterHeader } from "@/lib/letters/view";
import { cn } from "@/lib/utils";

type Props = {
  letter: LetterContent;
  header: LetterHeader;
  /** Libellés lisibles des sources (« Stage Talan, 2025 »). */
  sources: Record<string, string>;
  /** Options d'affichage de l'aperçu ; jamais activées pour le PDF. */
  showSources?: boolean;
  highlightTerms?: string[];
  className?: string;
};

const escapeRegExp = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

function highlight(text: string, terms: string[]): ReactNode {
  const usable = terms.map((t) => t.trim()).filter((t) => t.length >= 2);
  if (usable.length === 0) return text;
  const pattern = new RegExp(`(?<![\\p{L}\\p{N}])(${usable.map(escapeRegExp).join("|")})(?![\\p{L}\\p{N}])`, "giu");
  const parts = text.split(pattern);
  return parts.map((part, i) => (i % 2 === 1 ? <mark key={i} className="rounded-[2px] bg-mark px-0.5 text-inherit">{part}</mark> : <Fragment key={i}>{part}</Fragment>));
}

/** Numérotation des sources par ordre d'apparition dans la lettre. */
export function sourceOrder(letter: LetterContent): string[] {
  const order: string[] = [];
  for (const paragraph of letter.paragraphs) for (const sentence of paragraph.sentences) for (const id of sentence.sourceIds) if (!order.includes(id)) order.push(id);
  return order;
}

/**
 * Feuille de la lettre (A4, toujours claire, Newsreader) : même composant pour l'aperçu et, à l'étape 8, le PDF.
 * L'en-tête vient du profil et de l'analyse de l'offre, jamais du modèle.
 */
export function LetterSheet({ letter, header, sources, showSources = false, highlightTerms = [], className }: Props) {
  const order = sourceOrder(letter);
  const terms = highlightTerms;
  const subjectLabel = letter.language === "fr" ? "Objet : " : "Subject: ";

  return (
    <article
      lang={letter.language}
      className={cn("letter-sheet mx-auto flex w-full max-w-[210mm] flex-col gap-4 bg-sheet px-[clamp(1.25rem,6%,3.25rem)] py-[clamp(1.5rem,7%,3.5rem)] font-letter text-[0.95rem] leading-relaxed text-sheet-foreground shadow-sm", className)}
    >
      <header className="flex flex-wrap justify-between gap-6 text-sm">
        <div className="flex flex-col">
          <span className="font-semibold">{header.senderName}</span>
          {header.senderLines.map((line) => (
            <span key={line}>{line}</span>
          ))}
        </div>
        <div className="flex flex-col text-right">
          {header.recipientLines.map((line) => (
            <span key={line}>{line}</span>
          ))}
          <span className="mt-2">{header.placeAndDate}</span>
        </div>
      </header>

      <p className="font-sans text-sm font-semibold">
        {subjectLabel}
        {letter.subject}
      </p>
      <p>{letter.salutation}</p>

      {letter.paragraphs.map((paragraph, p) => (
        <p key={p} data-letter-paragraph>
          {paragraph.sentences.map((sentence, s) => (
            <Fragment key={s}>
              {s > 0 && " "}
              {terms.length ? highlight(sentence.text, terms) : sentence.text}
              {showSources &&
                sentence.sourceIds.map((id) => {
                  const label = sources[id] ?? "Profil";
                  const n = order.indexOf(id) + 1;
                  return (
                    <button
                      key={id}
                      type="button"
                      aria-label={`Source ${n} : ${label}`}
                      className="group relative mx-0.5 inline-flex h-4 min-w-4 -translate-y-1.5 items-center justify-center rounded-full bg-[#e3e8f4] px-1 align-baseline font-sans text-[10px] font-semibold text-[#1c2a4a] focus-visible:outline-2"
                    >
                      {n}
                      <span
                        role="tooltip"
                        className="pointer-events-none absolute bottom-full left-1/2 z-10 mb-1.5 hidden -translate-x-1/2 rounded bg-[#1c2a4a] px-2 py-1 text-xs font-medium whitespace-nowrap text-white group-hover:block group-focus-visible:block"
                      >
                        {label}
                      </span>
                    </button>
                  );
                })}
            </Fragment>
          ))}
        </p>
      ))}

      <p>{letter.closing}</p>
      <p className="font-semibold">{header.senderName}</p>

      {showSources && order.length > 0 && (
        <footer className="mt-2 border-t border-[#d9dde6] pt-3 font-sans text-xs text-[#5f6880]">
          <ol className="flex flex-col gap-0.5">
            {order.map((id, i) => (
              <li key={id}>
                {i + 1}. {sources[id] ?? "Profil"}
              </li>
            ))}
          </ol>
        </footer>
      )}
    </article>
  );
}
