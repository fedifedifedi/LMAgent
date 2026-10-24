// Test réel des questions de l'agent : UN tour Cominty (profil fictif de Léa Dubois, offre fictive avec des manques),
// arrêté dès que les questions arrivent (pas de tour de réponse). Ne l'exécuter qu'avec l'accord de l'utilisateur.
// Lancer : npm run cominty:questions
import { createMigratedDatabase } from "../tests/helpers/test-db";

const OFFER = `Stage IA — Nexora Labs, Lyon, France (hybride).
Début : février 2027, 6 mois.
Missions : industrialiser des modèles de prévision en Python et SQL ; déployer les services sur Kubernetes ; prototyper des assistants avec LangChain.
Profil : master data science ; Python et SQL indispensables ; Kubernetes indispensable ; LangChain apprécié ; anglais professionnel.`;

const { url } = await createMigratedDatabase();
process.env.DATABASE_URL = url; // base temporaire : dev.db n'est pas touchée
const { db } = await import("@/lib/db");
const { createComintyClient } = await import("@/lib/cominty/client");
const { readComintyConfig } = await import("@/lib/cominty/config");
const { guardedClient } = await import("@/lib/cominty/guard");
const { followAgentRun, startAgentRun } = await import("@/lib/letters/agent-run");
const { createProfile } = await import("@/lib/repositories/profiles");
const { DEMO_PROFILE } = await import("@/lib/demo");

const real = guardedClient(createComintyClient(readComintyConfig()));
// Un seul tour : aucune suite automatique (correction) n'est envoyée.
const client = { ...real, sendMessage: async () => Promise.reject(new Error("Test limité à UN tour.")) };
const saved = await createProfile(DEMO_PROFILE);
const letter = await db.letter.create({ data: { profileId: saved.id, offerText: OFFER } });
const started = Date.now();
const runId = await startAgentRun(letter.id, client);
await followAgentRun(runId, client, (event) => {
  if (event.type === "step") console.log(`  ${((Date.now() - started) / 1000).toFixed(0).padStart(4)} s  ${event.step.label} (${event.step.status})`);
  else console.log(`  → ${event.type}`);
});

const run = await db.agentRun.findUniqueOrThrow({ where: { id: runId } });
const charge = await db.comintyCharge.findFirst();
const after = await db.letter.findUniqueOrThrow({ where: { id: letter.id }, select: { status: true, analysis: true } });
console.log(`\nStatut : ${after.status} · ${((Date.now() - started) / 1000).toFixed(0)} s · ${charge?.costUsd ?? "?"} $ · analyse enregistrée : ${Boolean(after.analysis)}`);
console.log("Questions standardisées :", JSON.stringify(run.questions, null, 2));
console.log("Réponse brute de l'agent (début) :", run.error ?? "(voir le flux)");
