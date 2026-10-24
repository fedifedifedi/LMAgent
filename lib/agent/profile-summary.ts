import { generateObject } from "@/lib/llm";
import type { LLMProvider, LLMUsage } from "@/lib/llm/types";
import { ProfileSummarySchema } from "@/lib/agent/schemas";

type CallOptions = { provider?: LLMProvider; onUsage?: (usage: LLMUsage) => void };

export const PROFILE_SUMMARY_SYSTEM = `You write the summary of a candidate profile: two to four sentences, first person, in the language of the profile.
Use only facts present in the profile (degree, experiences, skills, what the candidate is looking for). No invention, no generic praise.
This is a proposal the candidate will review and edit.`;

/** « Proposer un résumé » du formulaire du profil : une tâche JSON de l'agent Cominty (relue par le candidat). */
export async function suggestProfileSummary(profile: unknown, options: CallOptions = {}): Promise<string> {
  const { data } = await generateObject({
    output: { name: "profile_summary", schema: ProfileSummarySchema },
    system: PROFILE_SUMMARY_SYSTEM,
    prompt: `Profile:\n${JSON.stringify(profile, null, 2)}`,
    ...options,
  });
  return data.summary;
}
