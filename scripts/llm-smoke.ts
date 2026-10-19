// Test réel du provider configuré dans .env.local (appels payants / soumis aux quotas).
// Lancer : npm run llm:smoke   — la clé API n'est jamais lue ni affichée ici.
import { z } from "zod";
import { generateObject, getProvider, type LLMUsage } from "@/lib/llm";
import { LLM_OUTPUTS } from "@/lib/schemas/llm-outputs";

const CV = `Léa Dubois — Data scientist junior
lea.dubois@example.com · Bordeaux · github.com/lea-dubois-example
Recherche un stage de fin d'études (6 mois) à partir de février 2027, mobile en France, télétravail possible.

EXPÉRIENCE
Data analyst (alternance) — Banque Atlantique, Bordeaux — sept. 2024 à aujourd'hui
- Modèle de scoring de churn en Python (scikit-learn), +12 % de précision par rapport au modèle existant
- Tableaux de bord Power BI utilisés par 40 conseillers

Serveuse (temps partiel) — Café du Port — 2022 à 2024

FORMATION
Master Data Science, Université de Bordeaux, 2023 – 2025

COMPÉTENCES : Python, SQL, scikit-learn, Power BI, Git
LANGUES : français (langue maternelle), anglais courant (C1), espagnol notions`;

function show(title: string, result: { data: unknown; usage: LLMUsage; degraded: boolean; issues?: string }) {
  console.log(`\n=== ${title} ===`);
  console.log(JSON.stringify(result.data, null, 2));
  console.log("usage:", result.usage);
  console.log("tentatives:", result.usage.attempts, "| degraded:", result.degraded);
  if (result.issues) console.log("erreurs restantes:\n" + result.issues);
}

async function run(title: string, call: () => Promise<Parameters<typeof show>[1]>) {
  try {
    show(title, await call());
  } catch (error) {
    console.error(`\n=== ${title} : ÉCHEC ===`);
    console.error(error instanceof Error ? `${error.name}: ${error.message}` : error);
  }
}

const provider = getProvider();
console.log(`provider: ${provider.name} | modèle: ${provider.model}`);

await run("1. Petit schéma", () =>
  generateObject({
    provider,
    output: {
      name: "city",
      schema: z.object({
        city: z.string(),
        country: z.enum(["France", "Belgique", "Suisse", "Canada"]),
        population: z.number().int().describe("Approximate population of the city"),
        foundedYear: z.string().regex(/^\d{4}$/).describe("Year, format YYYY").optional(),
      }),
    },
    system: "Answer with facts about the city mentioned by the user.",
    prompt: "Lyon",
  }),
);

await run("2. profile_draft (ProfileTargetSchema)", () =>
  generateObject({
    provider,
    output: LLM_OUTPUTS.profile_draft,
    system:
      "Extract the candidate profile from the CV. Only use information present in the CV; leave fields out when absent. Keep the CV language for free text.",
    prompt: CV,
  }),
);
