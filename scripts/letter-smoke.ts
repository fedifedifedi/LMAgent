// Test réel du pipeline de lettre avec le provider de .env.local (5 appels au plus ; la clé n'est jamais affichée).
// Lancer : npm run letter:smoke
import { analyzeOffer, critiqueLetter, matchProfile, writeLetter } from "@/lib/agent/letter-agent";
import { checkLetter, letterText, letterWordCount } from "@/lib/agent/letter-checks";
import { getProvider, type LLMUsage } from "@/lib/llm";
import { ProfileSchema } from "@/lib/schemas/profile";

const OFFER = `Data Science Intern (6 months) — Northwind Analytics, Lyon (hybrid)
Start: February 2027. Contact: Ms Emily Carter, Head of Data.

Northwind Analytics builds demand forecasting tools for European retailers.
Missions: build and evaluate churn and demand models in Python; create dashboards for business teams; deploy models with Docker.
Profile: final-year student in data science; Python, SQL, scikit-learn required; Docker required; Power BI is a plus; fluent English.`;

const profile = ProfileSchema.parse({
  identity: { firstName: "Léa", lastName: "Dubois", headline: "Data scientist junior" },
  contact: { email: "lea.dubois@example.com", city: "Bordeaux" },
  summary: "Étudiante en master Data Science, en alternance comme data analyst, je construis des modèles de scoring et des tableaux de bord utilisés au quotidien.",
  availability: { contractTypes: ["pfe-internship"], durationMonths: 6, startDate: "2027-02", mobility: { countries: ["France"] }, acceptsRemote: true },
  experiences: [
    {
      id: "exp-banque-atlantique-2024", title: "Data analyst (alternance)", company: "Banque Atlantique", type: "apprenticeship", start: "2024-09", end: null,
      achievements: ["Modèle de scoring de churn en Python (scikit-learn), +12 % de précision par rapport au modèle existant", "Tableaux de bord Power BI utilisés par 40 conseillers"],
      skills: ["Python", "scikit-learn", "Power BI", "SQL"],
    },
  ],
  education: [{ id: "edu-bordeaux-2023", degree: "Master Data Science", school: "Université de Bordeaux", start: "2023", end: "2025" }],
  skills: [{ category: "Data", items: ["Python", "SQL", "scikit-learn", "Power BI", "Git"] }],
  languages: [{ name: "Anglais", level: "C1" }, { name: "Français", level: "native" }],
});

const provider = getProvider();
const fast = getProvider(process.env, "fast");
const usages: Array<[string, LLMUsage]> = [];
// Comme l'application : analyse et correspondance sur LLM_MODEL_FAST (s'il est défini).
const track = (step: string) => ({ provider: step === "analyze" || step === "match" ? fast : provider, onUsage: (u: LLMUsage) => usages.push([step, u]) });
console.log(`provider: ${provider.name} | modèle : ${provider.model} | modèle rapide : ${fast.model}`);

try {
  const analysis = await analyzeOffer(OFFER, track("analyze"));
  console.log("\n=== Analyse ===\n", JSON.stringify({ ...analysis, missions: analysis.missions.length }, null, 2));
  const match = await matchProfile(analysis, profile, track("match"));
  console.log("\n=== Correspondance ===");
  for (const r of match.requirements) console.log(`  ${r.status.padEnd(8)} ${r.name}  [${r.sourceIds.join(", ")}]`);
  const draft = await writeLetter({ analysis, match, profile }, track("write"));
  const critique = await critiqueLetter({ letter: draft, analysis, match, profile }, track("critique"));
  const checks = checkLetter(draft, { analysis, match });
  console.log(`\n=== Critique : ${critique.verdict} ===`);
  for (const issue of critique.issues) console.log(`  ${issue.kind}: ${issue.explanation}`);
  for (const check of checks) console.log(`  [code] ${check.kind}: ${check.message}`);

  let final = draft;
  if (critique.verdict === "rewrite" || checks.length > 0) {
    final = await writeLetter({ analysis, match, profile, feedback: { critique, checks, previous: draft } }, track("rewrite"));
  }
  console.log(`\n=== Lettre finale (${letterWordCount(final)} mots, ${final.language}) ===`);
  console.log(`Subject: ${final.subject}\n${final.salutation}\n\n${letterText(final)}\n\n${final.closing}`);
  console.log("\nSources citées :", [...new Set(final.paragraphs.flatMap((p) => p.sentences.flatMap((s) => s.sourceIds)))].join(", "));
  console.log("Vérifications restantes :", checkLetter(final, { analysis, match }));
} catch (error) {
  console.error("\nÉCHEC :", error instanceof Error ? `${error.name}: ${error.message}` : error);
}

console.log("\n=== Usage ===");
for (const [step, u] of usages) console.log(`  ${step.padEnd(9)} in ${u.inputTokens} · out ${u.outputTokens} · ${u.attempts} tentative(s) · ${u.durationMs} ms`);
