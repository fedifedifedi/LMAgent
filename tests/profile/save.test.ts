import { describe, expect, test } from "bun:test";
import { createMockProvider } from "@/lib/llm/providers/mock";
import type { Profile } from "@/lib/schemas/profile";
import { setupTestDatabase } from "../helpers/test-db";

await setupTestDatabase();
const { db } = await import("@/lib/db");
const { importCv } = await import("@/lib/cv/import");
const { getCvImport } = await import("@/lib/repositories/cv-imports");
const { getProfile, listProfileCards, saveProfileFromImport } = await import("@/lib/repositories/profiles");

const profile = (summary: string): Profile => ({
  identity: { firstName: "Camille", lastName: "Martin", headline: "Développeuse" },
  contact: { email: "camille@example.com" },
  summary,
  availability: { contractTypes: ["pfe-internship"], mobility: { countries: [], cities: [] } },
  experiences: [{ id: "exp-acme", title: "Dev", company: "Acme", type: "internship", start: "2025", end: "2025", achievements: [], skills: ["React"] }],
  projects: [],
  education: [],
  skills: [{ category: "Web", items: ["React"] }],
  languages: [],
  interests: [],
});

async function newImport() {
  return importCv({ kind: "text", text: "Camille Martin — Développeuse\nStage chez Acme en 2025, React et TypeScript." }, { provider: createMockProvider() });
}

describe("saveProfileFromImport", () => {
  test("premier enregistrement : profil créé et relié à l'import", async () => {
    const { id: importId } = await newImport();
    const { id } = await saveProfileFromImport(importId, profile("Premier résumé."));

    expect((await getCvImport(importId))?.profileId).toBe(id);
    expect(await getProfile(id)).toMatchObject({ name: "Camille Martin", data: { summary: "Premier résumé." } });
  });

  test("import déjà relié : le même profil est mis à jour, pas de doublon", async () => {
    const { id: importId } = await newImport();
    const first = await saveProfileFromImport(importId, profile("Version 1."));
    const before = await db.profile.count();
    const second = await saveProfileFromImport(importId, profile("Version 2."));

    expect(second.id).toBe(first.id);
    expect(await db.profile.count()).toBe(before);
    expect((await getProfile(first.id))?.data.summary).toBe("Version 2.");
  });

  test("profil invalide : rien n'est créé ni relié", async () => {
    const { id: importId } = await newImport();
    const before = await db.profile.count();

    await expect(saveProfileFromImport(importId, { ...profile(""), summary: "" })).rejects.toThrow();
    expect(await db.profile.count()).toBe(before);
    expect((await getCvImport(importId))?.profileId).toBeNull();
  });

  test("import inconnu : erreur", async () => {
    await expect(saveProfileFromImport("inexistant", profile("x"))).rejects.toThrow(/Import introuvable/);
  });

  test("listProfileCards : titre et nombre d'éléments", async () => {
    const { id: importId } = await newImport();
    const { id } = await saveProfileFromImport(importId, profile("Carte."));
    const card = (await listProfileCards()).find((c) => c.id === id);
    expect(card).toMatchObject({ headline: "Développeuse", counts: { experiences: 1, projects: 0, skills: 1, letters: 0 } });
  });
});
