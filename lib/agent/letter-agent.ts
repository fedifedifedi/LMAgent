import { generateObject } from "@/lib/llm";
import type { LLMProvider, LLMUsage } from "@/lib/llm/types";
import { MAX_WORDS, MIN_WORDS, type LetterIssue } from "@/lib/agent/letter-checks";
import {
  CritiqueSchema,
  letterSchema,
  matchSchema,
  OfferAnalysisSchema,
  ProfileSummarySchema,
  type Critique,
  type LetterContent,
  type OfferAnalysis,
  type ProfileMatch,
} from "@/lib/agent/schemas";
import { buildSourceCatalog, profileForPrompt, sourceIds } from "@/lib/agent/sources";
import type { Profile } from "@/lib/schemas/profile";

type CallOptions = { provider?: LLMProvider; onUsage?: (usage: LLMUsage) => void };

const json = (value: unknown) => JSON.stringify(value, null, 2);

// ------------------------------------------------------------------------------------------------- analyzeOffer

export const ANALYZE_OFFER_SYSTEM = `You extract the key information of a job offer into the given JSON schema.
- Copy, do not write: use only what the offer states. Leave a field out when the offer does not give it. Never guess.
- language: the language the offer is written in.
- requirements: every skill, tool, language, degree or experience asked, short and as named in the offer, marked required or preferred.
- contact: only if the offer names a recruiter or contact person; keep the civility (Mme, M., Ms, Mr) only if written.
- companyFacts: facts about the company that the offer itself states.`;

export async function analyzeOffer(offerText: string, options: CallOptions = {}): Promise<OfferAnalysis> {
  const { data } = await generateObject({
    output: { name: "offer_analysis", schema: OfferAnalysisSchema },
    system: ANALYZE_OFFER_SYSTEM,
    prompt: `Job offer:\n\n${offerText}`,
    reasoning: "low",
    tier: "fast",
    ...options,
  });
  return data;
}

// ------------------------------------------------------------------------------------------------- matchProfile

export const MATCH_PROFILE_SYSTEM = `You compare a candidate profile with the analysis of a job offer.
- For each requirement of the offer: matched (the profile proves it), partial (related but not exactly) or missing (nothing in the profile).
- sourceIds: ids of the profile sources that prove it. Use only ids from the profile. A missing requirement has no source.
- evidence: what in the profile supports it, close to the profile wording.
- arguments: the 2 to 5 strongest concrete arguments for this offer, each backed by at least one source. Prefer results with numbers.
- Never treat something as matched if the profile does not state it.`;

export async function matchProfile(analysis: OfferAnalysis, profile: Profile, options: CallOptions = {}): Promise<ProfileMatch> {
  const catalog = buildSourceCatalog(profile);
  const { data } = await generateObject({
    output: { name: "profile_match", schema: matchSchema(sourceIds(catalog)) },
    system: MATCH_PROFILE_SYSTEM,
    prompt: `Offer analysis:\n${json(analysis)}\n\nCandidate profile:\n${json(profileForPrompt(profile, catalog))}`,
    reasoning: "medium",
    tier: "fast",
    ...options,
  });
  return data;
}

// ------------------------------------------------------------------------------------------------- writeLetter

export function writeLetterSystem(language: "fr" | "en"): string {
  const conventions =
    language === "fr"
      ? `- Write in French. Salutation: "Madame, Monsieur," unless the offer names a contact. With a named contact: "Madame Martin," or "Monsieur Martin," only if the civility is written; otherwise "Bonjour Sarah Martin,". Closing: a French formal formula ("Je vous prie d'agréer, Madame, Monsieur, l'expression de mes salutations distinguées." adapted to the salutation).`
      : `- Write in English, with English conventions. Salutation: "Dear Hiring Manager," unless the offer names a contact; with a named contact: "Dear Ms Smith," only if the civility is written, otherwise "Dear Sarah Smith,". Closing: "Kind regards," style formula, one line.`;
  return `You write a cover letter for the candidate, for this specific offer.
${conventions}
- Length: ${MIN_WORDS} to ${MAX_WORDS} words in the paragraphs (subject, salutation and closing not counted). It must fit on one page.
- Structure: 3 to 5 paragraphs. An opening that links the candidate to this role and company, 1 to 3 paragraphs of concrete arguments, a closing paragraph with availability and a request for an interview.
- Facts about the candidate come ONLY from the profile sources. Keep numbers and names exactly. Every sentence that states a fact about the candidate lists its sourceIds; sentences without such a fact (motivation, transitions) have empty sourceIds.
- Never mention, claim or promise skills listed under doNotClaim.
- Facts about the company come ONLY from the offer analysis (companyFacts, missions). Never invent anything about the company.
- No header: the candidate's name, contact details, date and the company address are added by the application.
- Write naturally and specifically. Avoid generic phrases that would fit any offer.`;
}

export async function writeLetter(
  input: { analysis: OfferAnalysis; match: ProfileMatch; profile: Profile; feedback?: { critique?: Critique; checks?: LetterIssue[]; previous?: LetterContent } },
  options: CallOptions = {},
): Promise<LetterContent> {
  const { analysis, match, profile, feedback } = input;
  const catalog = buildSourceCatalog(profile);
  const doNotClaim = match.requirements.filter((r) => r.status === "missing").map((r) => r.name);
  const sections = [
    `Offer analysis:\n${json(analysis)}`,
    `Arguments to use:\n${json(match.arguments)}`,
    `Requirements matched:\n${json(match.requirements.filter((r) => r.status !== "missing"))}`,
    `doNotClaim:\n${json(doNotClaim)}`,
    `Candidate profile:\n${json(profileForPrompt(profile, catalog))}`,
  ];
  if (feedback?.previous) {
    const problems = [...(feedback.critique?.issues ?? []).map((i) => `${i.kind}: ${i.explanation} Fix: ${i.fix}${i.quote ? ` (« ${i.quote} »)` : ""}`), ...(feedback.checks ?? []).map((c) => `${c.kind}: ${c.message}`)];
    sections.push(`Previous version of the letter:\n${json(feedback.previous)}`, `Rewrite it and fix these problems:\n- ${problems.join("\n- ")}`);
  }
  const { data } = await generateObject({
    output: { name: "letter_draft", schema: letterSchema(sourceIds(catalog)) },
    system: writeLetterSystem(analysis.language),
    prompt: sections.join("\n\n"),
    reasoning: "high",
    ...options,
  });
  return data;
}

// ------------------------------------------------------------------------------------------------- critique

export const CRITIQUE_SYSTEM = `You review a cover letter before it is sent. Be strict and concrete.
Check:
- unsupported_claim: a fact about the candidate that the profile sources do not state (check the cited sourceIds).
- contradiction: a fact that contradicts the profile (dates, numbers, names, roles).
- claims_missing_skill: the letter claims or mentions a requirement the match marked as missing.
- invented_company_fact: something about the company that the offer does not state.
- too_long / too_short: outside ${MIN_WORDS}–${MAX_WORDS} words in the paragraphs.
- wrong_language, addressing (named contact ignored, wrong conventions), generic (could fit any offer), tone.
verdict: "rewrite" if any issue matters for the recruiter or for truthfulness; "ok" otherwise. No issue for matters of taste.`;

export async function critiqueLetter(
  input: { letter: LetterContent; analysis: OfferAnalysis; match: ProfileMatch; profile: Profile },
  options: CallOptions = {},
): Promise<Critique> {
  const catalog = buildSourceCatalog(input.profile);
  const { data } = await generateObject({
    output: { name: "letter_critique", schema: CritiqueSchema },
    system: CRITIQUE_SYSTEM,
    prompt: [
      `Letter:\n${json(input.letter)}`,
      `Offer analysis:\n${json(input.analysis)}`,
      `Match (requirements and arguments):\n${json(input.match)}`,
      `Candidate profile:\n${json(profileForPrompt(input.profile, catalog))}`,
    ].join("\n\n"),
    reasoning: "high",
    ...options,
  });
  return data;
}

// ------------------------------------------------------------------------------------------------- résumé du profil

export const PROFILE_SUMMARY_SYSTEM = `You write the summary of a candidate profile: two to four sentences, first person, in the language of the profile.
Use only facts present in the profile (degree, experiences, skills, what the candidate is looking for). No invention, no generic praise.
This is a proposal the candidate will review and edit.`;

export async function suggestProfileSummary(profile: unknown, options: CallOptions = {}): Promise<string> {
  const { data } = await generateObject({
    output: { name: "profile_summary", schema: ProfileSummarySchema },
    system: PROFILE_SUMMARY_SYSTEM,
    prompt: `Profile:\n${json(profile)}`,
    reasoning: "medium",
    ...options,
  });
  return data.summary;
}
