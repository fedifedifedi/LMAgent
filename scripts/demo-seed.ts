// Données de démonstration fictives (Léa Dubois) pour les captures d'écran : base SQLite neuve dans un dossier
// temporaire (jamais prisma/dev.db), lettre produite par le flux de l'agent avec un faux agent Cominty (aucun appel réel)
// dont la réponse est cohérente avec le profil (scripts/demo/).
// Lancer : npm run demo:seed  → affiche DATABASE_URL et les ids à ouvrir (npm run start avec cette DATABASE_URL).
import { readFileSync } from "node:fs";
import path from "node:path";
import { createMigratedDatabase } from "../tests/helpers/test-db";

const demo = (file: string) => readFileSync(path.join(import.meta.dir, "demo", file), "utf8");
const json = (file: string) => JSON.parse(demo(file));

const { url } = await createMigratedDatabase();
process.env.DATABASE_URL = url; // avant le premier import de lib/db

const { db } = await import("@/lib/db");
const { importCv } = await import("@/lib/cv/import");
const { followAgentRun, startAgentRun } = await import("@/lib/letters/agent-run");
const { createMockComintyClient } = await import("@/lib/cominty/mock-client");
const { MOCK_FIXTURES } = await import("@/lib/llm/fixtures");
const { createMockProvider } = await import("@/lib/llm/providers/mock");
const { createProfile } = await import("@/lib/repositories/profiles");
const { DEMO_OFFER, DEMO_PROFILE_NAME } = await import("@/lib/demo");

const profile = json("lea-dubois.json");
// Ce que le modèle aurait lu dans le CV : tout sauf la disponibilité, que le CV ne précise pas.
const draft = { ...profile };
delete draft.availability;

// tests/fixtures/cv-sample.pdf est un CV fictif de Léa Dubois.
const cvPdf = new Uint8Array(readFileSync(path.join(import.meta.dir, "..", "tests", "fixtures", "cv-sample.pdf")));
const cvImport = await importCv({ kind: "file", name: "cv-lea-dubois.pdf", bytes: cvPdf }, { provider: createMockProvider({ ...MOCK_FIXTURES, profile_draft: draft }) });
const saved = await createProfile(profile, DEMO_PROFILE_NAME);

// Réponse « ready » de l'agent, cohérente avec le profil : chaque phrase cite un élément réel (scripts/demo/).
type Requirement = { name: string; status: "matched" | "partial" | "missing"; evidence: string; sourceIds: string[] };
const analysis = json("offer_analysis.json") as { requirements: Array<{ name: string; importance: string }> };
const match = json("profile_match.json") as { requirements: Requirement[] };
const importance = new Map(analysis.requirements.map((r) => [r.name, r.importance]));
const readyReply = () => ({
  status: "ready",
  analysis,
  score: 86,
  scoreReasons: [
    "Python, SQL et séries temporelles, indispensables, sont prouvés par le stage chez Banque Atlantique et le projet tramway.",
    "Power BI, apprécié, est utilisé par 40 conseillers chez Banque Atlantique.",
    "Docker, cité comme un plus, n'apparaît pas dans le profil.",
  ],
  strengths: match.requirements.filter((r) => r.status !== "missing").map((r) => ({ requirement: r.name, status: r.status, evidence: r.evidence, sourceIds: r.sourceIds })),
  gaps: match.requirements.filter((r) => r.status === "missing").map((r) => ({ requirement: r.name, importance: importance.get(r.name) ?? "preferred", note: "Absent du profil." })),
  letter: json("letter_draft.json"),
  cvAdjustments: [
    { section: "Expériences – Banque Atlantique", change: "Placer l'automatisation SQL en première puce.", reason: "L'offre demande de fiabiliser les chaînes de données en SQL.", sourceIds: ["exp-banque-atlantique-2025"] },
    { section: "Projets – Prévision de fréquentation du tramway", change: "Mettre « séries temporelles » dans le titre du projet.", reason: "Compétence indispensable de l'offre.", sourceIds: ["proj-prevision-tramway"] },
  ],
});

const client = createMockComintyClient({ delayMs: 0, askFirst: false, readyReply });
const letter = await db.letter.create({ data: { profileId: saved.id, offerText: DEMO_OFFER }, select: { id: true } });
await followAgentRun(await startAgentRun(letter.id, client), client, () => {});
const final = await db.letter.findUniqueOrThrow({ where: { id: letter.id }, select: { status: true, error: true } });
if (final.status !== "GENERATED") throw new Error(`Lettre de démo non générée : ${final.status} ${final.error ?? ""}`);

console.log(JSON.stringify({ DATABASE_URL: url, importId: cvImport.id, profileId: saved.id, letterId: letter.id }, null, 2));
