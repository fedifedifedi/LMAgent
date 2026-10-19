import { Fragment, type CSSProperties, type ReactNode } from "react";
import type { LetterHeader } from "@/lib/letters/view";
import type { StoredLetter } from "@/lib/letters/stored";
import { LETTER_TEMPLATES, type LetterTemplate } from "@/lib/letters/templates";
import { cn } from "@/lib/utils";

type Props = {
  letter: StoredLetter;
  header: LetterHeader;
  template: LetterTemplate;
  /** Libellés lisibles des sources (« Stage Talan, 2025 »). */
  sources?: Record<string, string>;
  /** Options d'affichage de l'aperçu ; jamais activées sur la page d'impression (PDF). */
  showSources?: boolean;
  highlightTerms?: string[];
  /** "print" : feuille A4 exacte (297 mm de haut), pour puppeteer. */
  mode?: "preview" | "print";
  /** Réduction du texte pour tenir sur une page (1 = taille du template). */
  scale?: number;
  className?: string;
};

const escapeRegExp = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

function highlight(text: string, terms: string[]): ReactNode {
  const usable = terms.map((t) => t.trim()).filter((t) => t.length >= 2);
  if (usable.length === 0) return text;
  const pattern = new RegExp(`(?<![\\p{L}\\p{N}])(${usable.map(escapeRegExp).join("|")})(?![\\p{L}\\p{N}])`, "giu");
  return text.split(pattern).map((part, i) => (i % 2 === 1 ? <mark key={i} className="rounded-[2px] bg-mark px-0.5 text-inherit">{part}</mark> : <Fragment key={i}>{part}</Fragment>));
}

/** Numérotation des sources par ordre d'apparition dans la lettre. */
export function sourceOrder(letter: StoredLetter): string[] {
  const order: string[] = [];
  for (const paragraph of letter.paragraphs) for (const sentence of paragraph.sentences) for (const id of sentence.sourceIds) if (!order.includes(id)) order.push(id);
  return order;
}

function Badge({ label, children, tone = "source" }: { label: string; children: ReactNode; tone?: "source" | "edited" }) {
  return (
    <button
      type="button"
      aria-label={label}
      className={cn(
        "group relative mx-0.5 inline-flex h-[1.35em] min-w-[1.35em] -translate-y-[0.35em] items-center justify-center rounded-full px-[0.35em] align-baseline font-sans text-[0.62em] leading-none font-semibold focus-visible:outline-2",
        tone === "source" ? "bg-[#e3e8f4] text-[#1c2a4a]" : "bg-[#fde8d7] text-[#8a3a12]",
      )}
    >
      {children}
      <span role="tooltip" className="pointer-events-none absolute bottom-full left-1/2 z-10 mb-1.5 hidden -translate-x-1/2 rounded bg-[#1c2a4a] px-2 py-1 text-xs font-medium whitespace-nowrap text-white group-hover:block group-focus-visible:block">
        {label}
      </span>
    </button>
  );
}

function Body({ letter, sources, showSources, highlightTerms, className }: { letter: StoredLetter; sources: Record<string, string>; showSources: boolean; highlightTerms: string[]; className?: string }) {
  const order = sourceOrder(letter);
  return (
    <div className={cn("flex flex-col", className)}>
      {letter.paragraphs.map((paragraph, p) => (
        <p key={p}>
          {paragraph.sentences.map((sentence, s) => (
            <Fragment key={s}>
              {s > 0 && " "}
              <span className={showSources && sentence.edited ? "underline decoration-[#d9a07a] decoration-dotted underline-offset-[0.2em]" : undefined}>
                {highlightTerms.length ? highlight(sentence.text, highlightTerms) : sentence.text}
              </span>
              {showSources && sentence.edited && <Badge label="Modifiée par toi (sans source)" tone="edited">✎</Badge>}
              {showSources &&
                sentence.sourceIds.map((id) => (
                  <Badge key={id} label={`Source ${order.indexOf(id) + 1} : ${sources[id] ?? "Profil"}`}>
                    {order.indexOf(id) + 1}
                  </Badge>
                ))}
            </Fragment>
          ))}
        </p>
      ))}
    </div>
  );
}

const subjectPrefix = (letter: StoredLetter) => (letter.language === "fr" ? "Objet : " : "Subject: ");

/**
 * Feuille de la lettre (A4, toujours claire) dans l'un des templates. Même composant pour l'aperçu et le PDF.
 * L'en-tête vient du profil et de l'analyse de l'offre, jamais du modèle. Aucune marque de l'outil sur la feuille.
 */
export function LetterDocument({ letter, header, template, sources = {}, showSources = false, highlightTerms = [], mode = "preview", scale = 1, className }: Props) {
  const base = LETTER_TEMPLATES[template].basePt;
  const style = { "--letter-pt": `${base}pt`, "--letter-scale": scale } as CSSProperties;
  const order = sourceOrder(letter);
  const bodyProps = { letter, sources, showSources, highlightTerms };
  const recipient = header.recipientLines;

  return (
    <article
      data-letter-sheet
      lang={letter.language}
      style={style}
      className={cn(
        "letter-sheet mx-auto flex w-[210mm] max-w-full flex-col bg-sheet font-letter text-sheet-foreground",
        "[font-size:calc(var(--letter-pt)*var(--letter-scale,1))]",
        mode === "print" ? "h-[297mm] max-w-none overflow-visible" : "min-h-[297mm] shadow-sm",
        className,
      )}
    >
      {template === "classique" && (
        <div className="flex flex-1 flex-col gap-[1.05em] px-[25mm] py-[25mm] leading-[1.55]">
          <header className="flex justify-between gap-[8mm] text-[0.86em] leading-[1.45]">
            <div className="flex flex-col">
              <span className="font-semibold">{header.senderName}</span>
              {header.senderLines.map((line) => <span key={line}>{line}</span>)}
            </div>
            <div className="flex flex-col text-right">
              {recipient.map((line) => <span key={line}>{line}</span>)}
              <span className="mt-[0.7em]">{header.placeAndDate}</span>
            </div>
          </header>
          <p className="mt-[0.6em] font-sans text-[0.86em] font-semibold">
            {subjectPrefix(letter)}
            {letter.subject}
          </p>
          <p>{letter.salutation}</p>
          <Body {...bodyProps} className="gap-[0.8em]" />
          <p>{letter.closing}</p>
          <p className="font-semibold">{header.senderName}</p>
        </div>
      )}

      {template === "moderne" && (
        <div className="flex flex-1 flex-col gap-[1.05em] px-[25mm] pt-[22mm] pb-[25mm] leading-[1.55]">
          <header className="flex flex-col">
            <span className="font-heading text-[2.4em] leading-none tracking-[-0.01em]">{header.senderName}</span>
            <span className="mt-[0.9em] font-sans text-[0.72em] font-medium tracking-[0.05em] text-[#5f6880] uppercase">{header.senderLines.join(" · ")}</span>
            <span aria-hidden="true" className="mt-[1.3em] mb-[0.4em] h-[1.2pt] w-[30mm] bg-[#1c2a4a]" />
          </header>
          <div className="flex justify-between gap-[8mm] font-sans text-[0.8em] leading-[1.45] text-[#3b4664]">
            <div className="flex flex-col">{recipient.map((line) => <span key={line}>{line}</span>)}</div>
            <span className="text-right">{header.placeAndDate}</span>
          </div>
          <p className="mt-[0.4em] font-heading text-[1.3em] leading-[1.2]">{letter.subject}</p>
          <p>{letter.salutation}</p>
          <Body {...bodyProps} className="gap-[0.8em]" />
          <p>{letter.closing}</p>
          <p className="font-heading text-[1.3em]">{header.senderName}</p>
        </div>
      )}

      {template === "compact" && (
        <div className="flex flex-1 flex-col gap-[0.75em] px-[18mm] py-[18mm] leading-[1.42]">
          <header className="flex flex-col gap-[0.35em] border-b border-[#d9dde6] pb-[0.7em] font-sans text-[0.8em]">
            <div className="flex items-baseline justify-between gap-[6mm]">
              <span className="text-[1.45em] font-semibold">{header.senderName}</span>
              <span className="text-right">{header.senderLines.join(" · ")}</span>
            </div>
            <div className="flex justify-between gap-[6mm] text-[#3b4664]">
              <span>{recipient.join(" · ")}</span>
              <span className="text-right">{header.placeAndDate}</span>
            </div>
          </header>
          <p className="mt-[0.4em] font-sans text-[0.86em] font-semibold">
            {subjectPrefix(letter)}
            {letter.subject}
          </p>
          <p>{letter.salutation}</p>
          <Body {...bodyProps} className="gap-[0.6em]" />
          <p>{letter.closing}</p>
          <p className="font-semibold">{header.senderName}</p>
        </div>
      )}

      {showSources && mode === "preview" && order.length > 0 && (
        <footer className="mx-[18mm] mb-[12mm] border-t border-[#d9dde6] pt-3 font-sans text-xs text-[#5f6880]">
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
