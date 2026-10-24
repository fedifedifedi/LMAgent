import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import path from "node:path";
import { DEMO_OFFER, DEMO_PROFILE_NAME, demoEnabled } from "@/lib/demo";
import { setupTestDatabase } from "../helpers/test-db";

await setupTestDatabase();
const { db } = await import("@/lib/db");
const { ensureDemoLetter } = await import("@/lib/demo/start");

describe("démo", () => {
  test("l'offre de l'app est identique à scripts/demo/offer.txt", () => {
    const file = readFileSync(path.join(import.meta.dir, "..", "..", "scripts", "demo", "offer.txt"), "utf8");
    expect(DEMO_OFFER.replace(/\r\n/g, "\n")).toBe(file.replace(/\r\n/g, "\n"));
  });

  test("clics répétés : un seul profil fictif et une seule lettre (pas de nouvel appel à l'agent)", async () => {
    const first = await ensureDemoLetter();
    const second = await ensureDemoLetter();
    expect(second).toBe(first);
    expect(await db.profile.count({ where: { name: DEMO_PROFILE_NAME } })).toBe(1);
    const letter = await db.letter.findUniqueOrThrow({ where: { id: first }, include: { profile: true } });
    expect(letter.offerText).toContain("Hélio Prévisions");
    expect(letter.profile.data).toMatchObject({ identity: { firstName: "Léa", lastName: "Dubois" } });
  });

  test("DEMO_ENABLED=0 masque la démo", () => {
    expect(demoEnabled({})).toBe(true);
    expect(demoEnabled({ DEMO_ENABLED: "0" })).toBe(false);
  });
});
