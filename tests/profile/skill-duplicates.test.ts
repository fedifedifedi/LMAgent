import { describe, expect, test } from "bun:test";
import type { ProfileFormValues } from "@/lib/profile/form-values";
import { findSkillDuplicates, mergeSkills, skillTokens } from "@/lib/profile/skill-duplicates";

// Cas réel : la synchronisation avait ajouté « Qdrant » et « LoRA » à « Autres compétences ».
const values = {
  skills: [
    { category: "IA générative & LLM", items: ["fine-tuning (LoRA)", "recherche vectorielle (Qdrant)", "RAG"] },
    { category: "Web", items: ["Node.js", "Next.js", "Git/GitHub"] },
    { category: "Autres compétences", items: ["Qdrant", "LoRA", "Git"] },
  ],
  experiences: [{ id: "exp-wind", title: "Stagiaire", company: "Wind Consulting", type: "internship", start: "2026", end: "2026", achievements: [], skills: ["Qdrant", "RAG"] }],
  projects: [{ id: "proj-a", name: "A", summary: "x", achievements: [], skills: ["LoRA", "fine-tuning (LoRA)"] }],
} as unknown as ProfileFormValues;

describe("skillTokens", () => {
  test("mots sans accents ni casse, Node.js et C++ gardés", () => {
    expect(skillTokens("Recherche vectorielle (Qdrant)")).toEqual(["recherche", "vectorielle", "qdrant"]);
    expect(skillTokens("Node.js")).toEqual(["node.js"]);
    expect(skillTokens("C++")).toEqual(["c++"]);
  });
});

describe("findSkillDuplicates", () => {
  test("une compétence entièrement contenue dans une autre est signalée", () => {
    expect(findSkillDuplicates(values)).toEqual([
      { short: "Qdrant", long: "recherche vectorielle (Qdrant)" },
      { short: "LoRA", long: "fine-tuning (LoRA)" },
      { short: "Git", long: "Git/GitHub" },
    ]);
  });

  test("pas de faux positif sur des mots seulement proches (Node.js / Next.js, RAG)", () => {
    const pairs = findSkillDuplicates(values).map((d) => d.short);
    expect(pairs).not.toContain("Node.js");
    expect(pairs).not.toContain("RAG");
  });
});

describe("mergeSkills", () => {
  test("garde la forme longue : remplacée partout, sans doublon, groupe vide retiré", () => {
    const merged = mergeSkills(mergeSkills(values, "Qdrant", "recherche vectorielle (Qdrant)"), "LoRA", "fine-tuning (LoRA)");
    expect(merged.skills.find((g) => g.category === "Autres compétences")?.items).toEqual(["Git"]);
    expect(merged.experiences[0].skills).toEqual(["recherche vectorielle (Qdrant)", "RAG"]);
    expect(merged.projects?.[0].skills).toEqual(["fine-tuning (LoRA)"]);
  });

  test("garde la forme courte", () => {
    const merged = mergeSkills(values, "recherche vectorielle (Qdrant)", "Qdrant");
    expect(merged.skills[0].items).toEqual(["fine-tuning (LoRA)", "Qdrant", "RAG"]);
    expect(merged.experiences[0].skills).toEqual(["Qdrant", "RAG"]);
  });

  test("groupe vidé retiré", () => {
    const merged = mergeSkills({ ...values, skills: [{ category: "Seule", items: ["Git"] }, { category: "Web", items: ["Git/GitHub"] }] }, "Git", "Git/GitHub");
    expect(merged.skills).toEqual([{ category: "Web", items: ["Git/GitHub"] }]);
  });
});
