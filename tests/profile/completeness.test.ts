import { describe, expect, test } from "bun:test";
import { profileCompleteness, profileTimeline, skillUsage } from "@/lib/profile/completeness";
import { ProfileSchema, type Profile } from "@/lib/schemas/profile";

const base: Profile = ProfileSchema.parse({
  identity: { firstName: "Léa", lastName: "Dubois", headline: "Data scientist junior" },
  contact: { email: "lea@example.com" },
  summary: "Court.",
  availability: { contractTypes: ["pfe-internship"] },
  experiences: [
    { id: "exp-cafe", title: "Serveuse", company: "Café du Port", type: "part-time", start: "2022", end: "2024", achievements: [], skills: [] },
    { id: "exp-banque", title: "Data analyst", company: "Banque Atlantique", type: "apprenticeship", start: "2024-09", end: null, achievements: ["Scoring de churn"], skills: ["Python", "SQL"] },
  ],
  projects: [{ id: "proj-rag", name: "Assistant RAG", summary: "Chatbot", start: "2023", end: "2023", achievements: [], skills: ["python"] }],
  education: [{ id: "edu-master", degree: "Master Data Science", school: "Université de Bordeaux", start: "2023", end: "2025" }],
  skills: [{ category: "Tech", items: ["Python", "SQL"] }],
  languages: [],
});

describe("profileCompleteness", () => {
  test("score et manques, les plus importants d'abord", () => {
    const { score, missing } = profileCompleteness(base);
    expect(score).toBeGreaterThan(0);
    expect(score).toBeLessThan(100);
    expect(missing[0].message).toBe("Résumé trop court (deux à quatre phrases).");
    expect(missing.map((m) => m.field)).toEqual(
      expect.arrayContaining(["availability.durationMonths", "experiences.0.achievements", "experiences.0.start", "languages", "skills"]),
    );
    expect(missing.map((m) => m.field)).not.toContain("experiences.1.achievements");
  });

  test("profil complet : 100 %", () => {
    const full = ProfileSchema.parse({
      ...base,
      summary: "Data scientist junior en alternance, je construis des modèles de scoring et des tableaux de bord utilisés au quotidien.",
      contact: { email: "lea@example.com", phone: "06 00 00 00 00", city: "Bordeaux", github: "https://github.com/lea" },
      availability: { contractTypes: ["pfe-internship"], durationMonths: 6, startDate: "2027-02", mobility: { cities: ["Lyon"] }, acceptsRemote: true },
      experiences: [base.experiences[1]],
      skills: [{ category: "Tech", items: ["Python", "SQL", "scikit-learn", "Power BI", "Git"] }],
      languages: [{ name: "Anglais", level: "C1" }],
    });
    expect(profileCompleteness(full)).toEqual({ score: 100, missing: [] });
  });
});

describe("profileTimeline", () => {
  test("en cours d'abord, puis du plus récent au plus ancien ; projets datés inclus", () => {
    expect(profileTimeline(base).map((e) => e.id)).toEqual(["exp-banque", "edu-master", "exp-cafe", "proj-rag"]);
  });
});

describe("skillUsage", () => {
  test("compte les expériences et projets par compétence, casse ignorée", () => {
    const usage = skillUsage(base);
    expect(usage.get("python")).toBe(2);
    expect(usage.get("sql")).toBe(1);
  });
});
