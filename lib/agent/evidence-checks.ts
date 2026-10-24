import type { LetterIssue } from "@/lib/agent/letter-checks";
import type { LetterContent, OfferAnalysis } from "@/lib/agent/schemas";
import { answerSources, type CandidateAnswer } from "@/lib/agent/questions";
import { buildSourceCatalog } from "@/lib/agent/sources";
import type { Profile } from "@/lib/schemas/profile";

/**
 * Relecture des preuves par le code (déterministe), phrase par phrase, contre le texte des sources citées :
 * - terme repris de l'offre sans source dans le CV (« découpage des documents » vient de l'offre, pas du CV) ;
 * - statut transféré d'une expérience à une autre (« livré à l'équipe » est le statut d'une autre expérience) ;
 * - verbe plus fort que celui du CV (« conçu » quand le CV dit « intégration »).
 * Les cas viennent d'un test réel (offre fictive Nexora Labs).
 */

export type EvidenceContext = {
  /** Texte de l'offre. */
  offerText: string;
  /** Texte de chaque source citable (id → contenu sérialisé de l'expérience, du projet...). */
  sources: Record<string, string>;
  /** Libellés lisibles (« Stage Talan Tunisie, 2025 ») pour les messages. */
  labels?: Record<string, string>;
  analysis?: Pick<OfferAnalysis, "jobTitle" | "company" | "contractType">;
};

const STOPWORDS = new Set(
  (
    "avec dans pour par sur sous des les une un du de la le et ou en au aux ces cet cette mes mon ma nos notre vos votre leur leurs " +
    "que qui quoi dont est sont ete etre avoir ainsi aussi tres plus moins tout tous toute toutes comme entre vers chez afin " +
    "the and for with from into this that these those your our their have has been were will would about over under " +
    "mais donc car sans lors deja ils elles nous vous ont son ses sa"
  ).split(" "),
);

/** Minuscules, sans accents, lettres et chiffres seulement : « Livré à l'équipe » → « livre a l equipe ». */
export function normalize(text: string): string {
  return text
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();
}

const tokens = (text: string) => normalize(text).split(" ").filter(Boolean);
const isContent = (word: string) => word.length >= 4 && !STOPWORDS.has(word);
const contains = (haystack: string, needle: string) => ` ${haystack} `.includes(` ${needle} `);

/** Statuts qui ne se transfèrent pas : la racine, et un libellé lisible. */
// « opérationnel » n'est pas un statut : c'est un adjectif, souvent appliqué à autre chose que le travail (au test réel,
// « questions opérationnelles » était signalé). Il reste contrôlé comme mot renforcé (STRONG_FAMILIES).
const STATUS_STEMS = ["livr", "deploy", "production", "adopt", "industrialis", "lance", "publie"];

/** Noms que « opérationnel » qualifie sans rien affirmer sur le travail du candidat (« questions opérationnelles »). */
const DESCRIPTIVE_NOUNS = new Set(["questions", "question", "besoins", "besoin", "equipes", "equipe", "enjeux", "problematiques", "taches", "contraintes", "donnees", "metiers", "sujets", "cas", "usages", "aspects", "niveau", "dimension", "excellence", "efficacite", "decisions", "indicateurs"]);

/** Familles de verbes plus forts que « intégrer », « contribuer », « utiliser » : ils doivent être écrits dans la source. */
const STRONG_FAMILIES: Array<{ label: string; stems: string[] }> = [
  { label: "concevoir / conception", stems: ["concu", "concue", "concus", "concevoir", "conception", "designed"] },
  { label: "garantir", stems: ["garanti", "garantie", "garanties", "garantis", "garantir", "garantit", "guaranteed"] },
  { label: "opérationnel", stems: ["operationnel", "operationnelle", "operationnels", "operationnelles", "operational"] },
  { label: "piloter", stems: ["pilote", "pilotee", "piloter", "pilotage", "led"] },
  { label: "diriger", stems: ["dirige", "dirigee", "diriger", "direction"] },
  { label: "architecturer", stems: ["architecture", "architecturer", "architecte", "architected"] },
  { label: "maîtriser", stems: ["maitrise", "maitriser", "maitrisee", "mastered", "expert", "expertise"] },
  { label: "superviser", stems: ["supervise", "superviser", "supervision", "supervised"] },
];

const sourceText = (ids: string[], sources: Record<string, string>) => normalize(ids.map((id) => sources[id] ?? "").join(" \n "));

/** Position de chaque mot dans la phrase d'origine (alignée sur les mots normalisés) : extraits lisibles, avec accents. */
type Shown = (from: number, to: number) => string;
function shownOf(text: string, count: number): Shown {
  const spans = [...text.matchAll(/[\p{L}\p{N}]+/gu)].map((m) => ({ start: m.index!, end: m.index! + m[0].length }));
  if (spans.length !== count) return (from, to) => normalize(text).split(" ").slice(from, to + 1).join(" ");
  return (from, to) => text.slice(spans[Math.max(0, from)].start, spans[Math.min(spans.length - 1, to)].end);
}

/** n-grammes (2 à 4 mots) qui commencent et finissent par un mot porteur de sens ; `shown` : l'extrait d'origine. */
function phrases(words: string[], shown: Shown): Array<{ gram: string; shown: string }> {
  const out = [];
  for (let n = 2; n <= 4; n++) {
    for (let i = 0; i + n <= words.length; i++) {
      const gram = words.slice(i, i + n);
      if (isContent(gram[0]) && isContent(gram[n - 1])) out.push({ gram: gram.join(" "), shown: shown(i, i + n - 1) });
    }
  }
  return out;
}

/** Statuts exprimés par un nom après « en » (« mis en production ») : on montre les mots qui précèdent. */
const NOUN_STATUS = new Set(["production"]);

/** Statut + premier mot porteur de sens qui suit (« livre equipe », « livre pret ») : ce qui distingue deux statuts. */
function statusKeys(words: string[], shown: Shown): Array<{ stem: string; key: string; phrase: string }> {
  const keys = [];
  for (let i = 0; i < words.length; i++) {
    const stem = STATUS_STEMS.find((s) => words[i].startsWith(s));
    if (!stem) continue;
    const offset = words.slice(i + 1, i + 5).findIndex(isContent);
    const next = offset >= 0 ? words[i + 1 + offset] : undefined;
    // « mis en production » (statut nommé après « en ») ou « livré à l'équipe » (jusqu'au mot porteur de sens suivant).
    const phrase = NOUN_STATUS.has(stem) ? shown(i - 2, i) : shown(i, offset >= 0 ? i + 1 + offset : i);
    keys.push({ stem, key: next ? `${stem}…${next}` : stem, phrase });
  }
  return keys;
}

function hasStatus(text: string, stem: string, key: string): boolean {
  const words = text.split(" ");
  const next = key.includes("…") ? key.split("…")[1] : undefined;
  return words.some((w, i) => w.startsWith(stem) && (!next || words.slice(i + 1, i + 5).includes(next)));
}

export function checkEvidence(letter: LetterContent, context: EvidenceContext): LetterIssue[] {
  const issues: LetterIssue[] = [];
  const seen = new Set<string>();
  const push = (issue: LetterIssue) => {
    if (seen.has(issue.message)) return;
    seen.add(issue.message);
    issues.push(issue);
  };

  const offer = normalize(context.offerText);
  const profile = normalize(Object.values(context.sources).join(" \n "));
  const identity = normalize([context.analysis?.jobTitle, context.analysis?.company, context.analysis?.contractType].filter(Boolean).join(" "));
  const labelOf = (id: string) => context.labels?.[id] ?? id;
  const citedLabel = (ids: string[]) => ids.map(labelOf).join(", ");

  for (const paragraph of letter.paragraphs) {
    for (const sentence of paragraph.sentences) {
      // Seules les phrases qui affirment un fait sur le candidat (avec source) sont vérifiées.
      // Réponses du candidat : leur texte n'est pas un élément du profil, on ne peut pas les comparer.
      if (sentence.sourceIds.length === 0 || sentence.sourceIds.includes("candidate-answers")) continue;
      const words = tokens(sentence.text);
      const shown = shownOf(sentence.text, words.length);
      const cited = sourceText(sentence.sourceIds, context.sources);

      // 1. Terme repris de l'offre : présent dans l'offre, absent des sources citées, avec un mot inconnu du profil.
      for (const { gram, shown: label } of phrases(words, shown)) {
        if (!contains(offer, gram) || contains(cited, gram) || contains(identity, gram)) continue;
        if (gram.split(" ").filter(isContent).some((w) => !contains(profile, w))) {
          push({ kind: "offer_term_unsourced", sentence: sentence.text, message: `« ${label} » vient de l'offre, pas du CV : ce terme n'apparaît pas dans la source citée (${citedLabel(sentence.sourceIds)}).` });
        }
      }

      // 2. Statut transféré : le statut de la phrase n'est pas celui de la source citée.
      for (const status of statusKeys(words, shown)) {
        if (hasStatus(cited, status.stem, status.key)) continue;
        const elsewhere = Object.entries(context.sources).find(([id, text]) => !sentence.sourceIds.includes(id) && hasStatus(normalize(text), status.stem, status.key));
        push({
          kind: "status_transferred",
          sentence: sentence.text,
          message: elsewhere
            ? `« ${status.phrase} » est le statut de ${labelOf(elsewhere[0])}, pas de ${citedLabel(sentence.sourceIds)} : ne transfère pas un statut d'une expérience à une autre.`
            : `« ${status.phrase} » : ce statut n'est pas écrit dans le CV pour ${citedLabel(sentence.sourceIds)}.`,
        });
      }

      // 3. Verbe plus fort que le CV : la famille du verbe doit être présente dans la source citée.
      for (const family of STRONG_FAMILIES) {
        const at = words.findIndex((w, i) => family.stems.includes(w) && !(family.label === "opérationnel" && DESCRIPTIVE_NOUNS.has(words[i - 1] ?? "")));
        if (at >= 0 && !family.stems.some((stem) => cited.split(" ").includes(stem))) {
          const used = shown(at, at);
          push({ kind: "verb_inflated", sentence: sentence.text, message: `« ${used} » est plus fort que ce que dit le CV pour ${citedLabel(sentence.sourceIds)} (famille « ${family.label} » absente) : reprends le verbe du CV.` });
        }
      }
    }
  }
  return issues;
}

/**
 * Contexte de relecture à partir du profil validé, du texte de l'offre et des réponses « Oui » du candidat (sources
 * candidate-answer-N, vérifiées comme un élément du CV : pas de verbe renforcé ni de statut ajouté).
 */
export function evidenceContext(profile: Profile, offerText: string, answers: CandidateAnswer[] = []): EvidenceContext {
  const entries = [
    ...buildSourceCatalog(profile).map((entry) => ({ id: entry.id, label: entry.label, text: JSON.stringify(entry.content ?? "") })),
    ...answerSources(answers),
  ];
  return {
    offerText,
    sources: Object.fromEntries(entries.map((entry) => [entry.id, entry.text])),
    labels: Object.fromEntries(entries.map((entry) => [entry.id, entry.label])),
  };
}