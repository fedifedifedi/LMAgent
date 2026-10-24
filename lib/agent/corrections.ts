import { z } from "zod";
import { extractJsonText } from "@/lib/cominty/json";
import { EVIDENCE_ISSUE_KINDS, type LetterIssue } from "@/lib/agent/letter-checks";
import type { LetterContent } from "@/lib/agent/schemas";
import { normalizeLetterText } from "@/lib/letters/text";

/**
 * Correction ciblée de la relecture : l'agent ne réécrit plus toute la réponse (105 s au test réel), il renvoie
 * seulement les phrases signalées corrigées (ou "" pour les retirer) et, si la lettre passe sous 250 mots, des phrases
 * de compensation sourcées. Le code les applique, puis les relit : une phrase encore signalée est retirée, sans
 * nouveau tour d'agent.
 */

/** Référence d'une phrase : « P2.S1 » = 1re phrase du 2e paragraphe. */
export const sentenceRef = (paragraph: number, sentence: number) => `P${paragraph + 1}.S${sentence + 1}`;

export function correctionsReplySchema(ids: [string, ...string[]]) {
  const source = z.enum(ids);
  return z.object({
    status: z.literal("corrections"),
    replacements: z.array(z.object({ ref: z.string(), text: z.string(), sourceIds: z.array(source).default([]) })).default([]),
    additions: z.array(z.object({ after: z.string(), text: z.string().min(1), sourceIds: z.array(source).min(1) })).max(3).default([]),
  });
}
export type CorrectionsReply = z.infer<ReturnType<typeof correctionsReplySchema>>;

/** null : la réponse n'est pas une correction ciblée (l'agent a peut-être renvoyé l'objet complet). */
export function parseCorrections(content: string, ids: [string, ...string[]]): { ok: true; reply: CorrectionsReply } | { ok: false; issues: string } | null {
  let json: unknown;
  try {
    json = JSON.parse(extractJsonText(content));
  } catch {
    return null;
  }
  if ((json as { status?: unknown } | null)?.status !== "corrections") return null;
  const parsed = correctionsReplySchema(ids).safeParse(json);
  return parsed.success ? { ok: true, reply: parsed.data } : { ok: false, issues: z.prettifyError(parsed.error) };
}

type Sentence = LetterContent["paragraphs"][number]["sentences"][number];
type Slot = Sentence & { touched: boolean; origin?: string };

/**
 * Applique la correction, puis relit la lettre avec check : toute phrase signalée à l'origine, corrigée ou ajoutée
 * qui reste signalée (preuve ou répétition) est retirée. Renvoie la lettre et, pour chaque phrase d'origine signalée,
 * sa version finale (null si retirée).
 */
export function applyCorrections(
  letter: LetterContent,
  reply: CorrectionsReply,
  flagged: string[],
  check: (letter: LetterContent) => LetterIssue[],
): { letter: LetterContent; outcomes: Map<string, string | null>; added: number } {
  const replacements = new Map(reply.replacements.map((r) => [r.ref.trim().toUpperCase(), r]));
  const additions = new Map<string, CorrectionsReply["additions"]>();
  for (const a of reply.additions) additions.set(a.after.trim().toUpperCase(), [...(additions.get(a.after.trim().toUpperCase()) ?? []), a]);
  const flaggedSet = new Set(flagged);

  let paragraphs: Slot[][] = letter.paragraphs.map((p, pi) =>
    p.sentences.flatMap((s, si) => {
      const ref = sentenceRef(pi, si);
      const replacement = replacements.get(ref);
      const slot: Slot = replacement
        ? { text: normalizeLetterText(replacement.text), sourceIds: replacement.sourceIds, touched: true, origin: s.text }
        : { ...s, touched: flaggedSet.has(s.text), origin: s.text };
      const extra = (additions.get(ref) ?? []).map((a) => ({ text: normalizeLetterText(a.text), sourceIds: a.sourceIds, touched: true }));
      return [...(slot.text.trim() ? [slot] : []), ...extra];
    }),
  );
  const build = (): LetterContent => ({
    ...letter,
    paragraphs: paragraphs.filter((p) => p.length).map((p) => ({ sentences: p.map(({ text, sourceIds }) => ({ text, sourceIds })) })),
  });

  // Relecture des phrases touchées : on retire celles qui restent signalées, jusqu'à ce qu'aucune ne le soit.
  for (let pass = 0; pass < 5; pass++) {
    const issues = check(build()).filter((i) => i.sentence && (EVIDENCE_ISSUE_KINDS.has(i.kind) || i.kind === "repeated_terms"));
    const drop = new Set<Slot>();
    for (const issue of issues) {
      for (const p of paragraphs) {
        const index = p.findIndex((s) => s.text === issue.sentence);
        if (index < 0) continue;
        // Répétition : la phrase signalée est la seconde ; on retire celle des deux qui a été touchée.
        const target = p[index].touched ? p[index] : issue.kind === "repeated_terms" && p[index - 1]?.touched ? p[index - 1] : undefined;
        if (target) drop.add(target);
      }
    }
    if (drop.size === 0) break;
    paragraphs = paragraphs.map((p) => p.filter((s) => !drop.has(s)));
  }

  const outcomes = new Map<string, string | null>(flagged.map((text) => [text, null]));
  for (const slot of paragraphs.flat()) if (slot.origin && flaggedSet.has(slot.origin)) outcomes.set(slot.origin, slot.text);
  return { letter: build(), outcomes, added: paragraphs.flat().filter((s) => !s.origin).length };
}
