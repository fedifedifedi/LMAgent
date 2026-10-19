import { beforeAll, describe, expect, test } from "bun:test";
import type { Profile } from "@/lib/schemas/profile";
import { setupTestDatabase } from "./helpers/test-db";

await setupTestDatabase();
const { db } = await import("@/lib/db");
const { buildFtsQuery, search, toTerms } = await import("@/lib/rag/search");
const { createProfile, deleteProfile, getProfile } = await import("@/lib/repositories/profiles");

const profileFixture = (firstName: string): Profile => ({
  identity: { firstName, lastName: "Test", headline: "Développeur" },
  contact: { email: `${firstName.toLowerCase()}@example.com` },
  summary: "Profil de test",
  availability: {
    contractTypes: ["pfe-internship"],
    startDate: "2027-02",
    mobility: { countries: ["France"], cities: [] },
    acceptsRemote: true,
  },
  experiences: [],
  projects: [],
  education: [],
  skills: [{ category: "Tech", items: ["Node.js"] }],
  languages: [],
  interests: [],
});

async function addDocument(owner: { profileId: string } | { letterId: string }, kind: string, texts: string[]) {
  return db.document.create({
    data: {
      ...owner,
      kind: kind as never,
      title: `${kind} doc`,
      content: texts.join("\n\n"),
      chunks: { create: texts.map((text, index) => ({ index, text })) },
    },
  });
}

let aliceId: string;
let bobId: string;

beforeAll(async () => {
  aliceId = (await createProfile(profileFixture("Alice"))).id;
  bobId = (await createProfile(profileFixture("Bob"))).id;

  await addDocument({ profileId: aliceId }, "PROJECT", [
    "Projet full-stack : API en Node.js et module de calcul en C++.",
    "Mise en place d'un pipeline RAG avec réécriture des requêtes.",
    "Expérience en gestion d'équipe et méthodes agiles.",
  ]);
  await addDocument({ profileId: aliceId }, "PAST_LETTER", ["Passionnée par Node.js, je souhaite rejoindre votre équipe."]);
  await addDocument({ profileId: bobId }, "PROJECT", ["Microservices Node.js chez Bob."]);
});


describe("échappement de la requête FTS5", () => {
  test("chaque terme est entre guillemets, joint par OR, guillemets internes doublés", () => {
    expect(buildFtsQuery(["C++", "Node.js", '"RAG"', "full-stack"])).toBe(
      '"C++" OR "Node.js" OR """RAG""" OR "full-stack"',
    );
  });

  test("une chaîne est découpée en termes, une liste garde ses éléments", () => {
    expect(toTerms('  C++ Node.js "RAG" full-stack  ')).toEqual(["C++", "Node.js", '"RAG"', "full-stack"]);
    expect(toTerms(["machine learning", "Node.js", "Node.js", " "])).toEqual(["machine learning", "Node.js"]);
  });

  test("requête vide : aucune requête SQL", () => {
    expect(buildFtsQuery([])).toBeNull();
  });
});

describe("search (BM25)", () => {
  test("requête avec caractères spéciaux : pas d'erreur de syntaxe FTS5, bons résultats", async () => {
    const hits = await search('C++ Node.js "RAG" full-stack', { profileId: aliceId });
    expect(hits.map((h) => h.text)).toEqual([
      "Projet full-stack : API en Node.js et module de calcul en C++.",
      "Mise en place d'un pipeline RAG avec réécriture des requêtes.",
    ]);
    expect(hits[0].score).toBeGreaterThan(hits[1].score);
  });

  test("accepte une liste de termes", async () => {
    const hits = await search(["pipeline RAG", "AND", "NEAR(", "*"], { profileId: aliceId });
    expect(hits).toHaveLength(1);
    expect(hits[0].text).toContain("pipeline RAG");
  });

  test("termes réduits à de la ponctuation : aucun résultat, pas d'erreur", async () => {
    expect(await search(["++", '"', "-"], { profileId: aliceId })).toEqual([]);
  });

  test("insensible aux accents et à la casse", async () => {
    const hits = await search("EXPERIENCE equipe", { profileId: aliceId });
    expect(hits[0].text).toContain("Expérience en gestion d'équipe");
  });

  test("par défaut, seulement les sources de faits ; le style uniquement sur demande", async () => {
    const facts = await search("passionnée", { profileId: aliceId });
    expect(facts).toEqual([]);
    const style = await search("passionnée", { profileId: aliceId, roles: ["style"] });
    expect(style).toHaveLength(1);
    expect(style[0]).toMatchObject({ kind: "PAST_LETTER", role: "style" });
  });

  test("isolé par profil", async () => {
    const hits = await search("microservices", { profileId: aliceId });
    expect(hits).toEqual([]);
    expect(await search("microservices", { profileId: bobId })).toHaveLength(1);
  });
});

describe("contraintes en base", () => {
  // Prisma remplace le message du RAISE(ABORT) par "Foreign key constraint violated" : on vérifie le rejet.
  test("COMPANY_PAGE refusée sur un profil, PROJECT refusé sans propriétaire", async () => {
    await expect(addDocument({ profileId: aliceId }, "COMPANY_PAGE", ["x"])).rejects.toThrow(/constraint/i);
    await expect(
      Promise.resolve(db.document.create({ data: { kind: "PROJECT", title: "orphelin", content: "x" } })),
    ).rejects.toThrow(/constraint/i);
    expect(await db.document.count({ where: { kind: "COMPANY_PAGE", profileId: aliceId } })).toBe(0);
  });

  test("COMPANY_PAGE acceptée sur une lettre et cherchable par letterId", async () => {
    const letter = await db.letter.create({ data: { profileId: aliceId, offerText: "Offre" } });
    await addDocument({ letterId: letter.id }, "COMPANY_PAGE", ["Acme conçoit des robots agricoles."]);
    const hits = await search("robots", { letterId: letter.id, roles: ["company"] });
    expect(hits).toHaveLength(1);
  });

  test("le profil est revalidé à l'écriture", async () => {
    await expect(createProfile({ identity: { firstName: "X" } })).rejects.toThrow();
  });

  test("suppression d'un profil : cascade jusqu'aux chunks et à l'index FTS5", async () => {
    const carol = await createProfile(profileFixture("Carol"));
    await addDocument({ profileId: carol.id }, "PROJECT", ["Kubernetes en production."]);
    expect(await search("kubernetes", { profileId: carol.id })).toHaveLength(1);

    await deleteProfile(carol.id);

    expect(await getProfile(carol.id)).toBeNull();
    expect(await db.document.count({ where: { profileId: carol.id } })).toBe(0);
    const [{ n }] = await db.$queryRaw<{ n: number | bigint }[]>`
      SELECT count(*) AS n FROM "chunk_fts" WHERE "chunk_fts" MATCH '"kubernetes"'`;
    expect(Number(n)).toBe(0);
  });
});
