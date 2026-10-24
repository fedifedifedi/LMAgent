// Enregistre un VRAI run de l'agent Cominty pour la démo (lettre de Léa Dubois, profil fictif) : UN seul appel payant
// (~0,18 $), sans correction ni réponse automatique. Ne l'exécuter qu'avec l'accord de l'utilisateur.
// Lancer : npm run demo:record  → remplace lib/demo/recorded-run.json (base temporaire, jamais prisma/dev.db).
import path from "node:path";
import { createMigratedDatabase } from "../tests/helpers/test-db";

const { url } = await createMigratedDatabase();
process.env.DATABASE_URL = url; // avant le premier import de lib/db

const { db } = await import("@/lib/db");
const { createComintyClient } = await import("@/lib/cominty/client");
const { readComintyConfig } = await import("@/lib/cominty/config");
const { guardedClient } = await import("@/lib/cominty/guard");
const { followAgentRun, startAgentRun } = await import("@/lib/letters/agent-run");
const { getLetterView } = await import("@/lib/letters/view");
const { letterText, letterWordCount } = await import("@/lib/agent/letter-checks");
const { createProfile } = await import("@/lib/repositories/profiles");
const { DEMO_OFFER, DEMO_PROFILE, DEMO_PROFILE_NAME } = await import("@/lib/demo");

const real = guardedClient(createComintyClient(readComintyConfig()));
// Un seul appel : toute suite (correction automatique, réponse) est refusée au lieu d'être envoyée.
const client = {
  ...real,
  sendMessage: async () => {
    throw new Error("Enregistrement limité à UN appel : pas de correction ni de réponse automatique.");
  },
};

const saved = await createProfile(DEMO_PROFILE, DEMO_PROFILE_NAME);
const letter = await db.letter.create({ data: { profileId: saved.id, offerText: DEMO_OFFER } });
const started = Date.now();
await followAgentRun(await startAgentRun(letter.id, client), client, (event) => {
  if (event.type === "step") console.log(`  ${((Date.now() - started) / 1000).toFixed(0).padStart(4)} s  ${event.step.label} (${event.step.status})`);
  else console.log(`  → ${event.type}${event.type === "failed" ? ` : ${event.error}` : ""}`);
});

const view = (await getLetterView(letter.id))!;
if (view.status !== "GENERATED" || !view.letter || !view.analysis || !view.match || !view.insights) {
  console.error(`\nPas de lettre exploitable (${view.status}) : l'enregistrement de la démo n'est PAS remplacé.`, view.error ?? "");
  process.exit(1);
}

const run = await db.agentRun.findFirstOrThrow({ where: { letterId: letter.id, kind: "START" }, include: { events: true } });
const call = await db.llmCall.findFirstOrThrow({ where: { letterId: letter.id, step: "AGENT_LETTER" } });
const events = [...run.events].sort((a, b) => a.correlationId - b.correlationId || a.at.getTime() - b.at.getTime());
const t0 = Math.min(...events.map((e) => e.at.getTime()));
const importance = new Map(view.analysis.requirements.map((r) => [r.name, r.importance]));
const reply = {
  status: "ready",
  analysis: view.analysis,
  score: view.insights.score,
  scoreReasons: view.insights.scoreReasons,
  strengths: view.match.requirements.filter((r) => r.status !== "missing").map((r) => ({ requirement: r.name, status: r.status, evidence: r.evidence, sourceIds: r.sourceIds })),
  gaps: view.match.requirements.filter((r) => r.status === "missing").map((r) => ({ requirement: r.name, importance: importance.get(r.name) ?? "preferred", note: "Absent du profil." })),
  letter: view.letter,
  cvAdjustments: view.insights.cvAdjustments,
};
const recorded = {
  description: `Vrai run de l'agent Cominty (${new Date(t0).toLocaleDateString("fr-FR")}, profil fictif Léa Dubois, offre Hélio Prévisions, règles de preuve), rejoué par la démo sans appel.`,
  recordedAt: new Date(t0).toISOString(),
  durationMs: call.durationMs,
  cost: { input_tokens: call.inputTokens, output_tokens: call.outputTokens, cached_tokens: call.cacheReadTokens ?? 0, total: call.costUsd ?? 0 },
  events: events.map((e) => ({ correlationId: e.correlationId, name: e.name, status: e.status, offsetMs: e.at.getTime() - t0 })),
  reply,
};
await Bun.write(path.join(import.meta.dir, "..", "lib", "demo", "recorded-run.json"), JSON.stringify(recorded, null, 2) + "\n");

const text = `${view.letter.subject}\n${view.letter.salutation}\n${letterText(view.letter)}\n${view.letter.closing}`;
console.log(`\n=== Lettre (${letterWordCount(view.letter)} mots, score ${view.insights.score}, ${call.costUsd} $, ${(call.durationMs / 1000).toFixed(0)} s) ===\n${text}`);
console.log("\nVérifications du code :", JSON.stringify(view.checks));
for (const phrase of ["deuxième année", "dernière année", "cycle complet", "maîtrise", "maîtriser"]) {
  console.log(`  « ${phrase} » : ${text.toLocaleLowerCase("fr").includes(phrase) ? "PRÉSENT" : "absent"}`);
}
console.log("\nlib/demo/recorded-run.json remplacé.");
