// Données de démonstration fictives (Léa Dubois) pour les captures d'écran : base SQLite neuve dans un dossier
// temporaire (jamais prisma/dev.db), provider mock avec les fixtures cohérentes de scripts/demo/.
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
const { runNextStep } = await import("@/lib/letters/pipeline");
const { MOCK_FIXTURES } = await import("@/lib/llm/fixtures");
const { createMockProvider } = await import("@/lib/llm/providers/mock");
const { createProfile } = await import("@/lib/repositories/profiles");

const profile = json("lea-dubois.json");
// Ce que le modèle aurait lu dans le CV : tout sauf la disponibilité, que le CV ne précise pas.
const draft = { ...profile };
delete draft.availability;

const provider = createMockProvider({
  ...MOCK_FIXTURES,
  profile_draft: draft,
  offer_analysis: json("offer_analysis.json"),
  profile_match: json("profile_match.json"),
  letter_draft: json("letter_draft.json"),
  letter_critique: json("letter_critique.json"),
});

// tests/fixtures/cv-sample.pdf est un CV fictif de Léa Dubois.
const cvPdf = new Uint8Array(readFileSync(path.join(import.meta.dir, "..", "tests", "fixtures", "cv-sample.pdf")));
const cvImport = await importCv({ kind: "file", name: "cv-lea-dubois.pdf", bytes: cvPdf }, { provider });
const saved = await createProfile(profile);
const letter = await db.letter.create({ data: { profileId: saved.id, offerText: demo("offer.txt") }, select: { id: true } });
while (await runNextStep(letter.id, { provider }));

console.log(JSON.stringify({ DATABASE_URL: url, importId: cvImport.id, profileId: saved.id, letterId: letter.id }, null, 2));
