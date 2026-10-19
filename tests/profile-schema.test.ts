import { describe, expect, test } from "bun:test";
import { z } from "zod";
import { draftWarnings } from "@/lib/cv/draft-warnings";
import { AvailabilitySchema, ExperienceSchema, isIncompleteDate, ProfileDraftSchema } from "@/lib/schemas/profile";

const experience = (start: string, end: string | null) => ({
  id: "exp-test",
  title: "Dev",
  company: "Acme",
  type: "cdi",
  start,
  end,
  achievements: ["x"],
  skills: [],
});

describe("dates du profil : précision de la source", () => {
  test("YYYY et YYYY-MM acceptés, le reste refusé", () => {
    expect(ExperienceSchema.safeParse(experience("2022", "2024")).success).toBe(true);
    expect(ExperienceSchema.safeParse(experience("2022-03", null)).success).toBe(true);
    for (const bad of ["22", "2022-13", "2022-3", "mars 2022", "2022-03-01"]) {
      expect(ExperienceSchema.safeParse(experience(bad, null)).success).toBe(false);
    }
  });

  test("startDate : YYYY, YYYY-MM ou YYYY-MM-DD, sans format date dans le JSON Schema", () => {
    const startDate = AvailabilitySchema.shape.startDate;
    for (const ok of ["2027", "2027-02", "2027-02-15"]) expect(startDate.safeParse(ok).success).toBe(true);
    for (const bad of ["2027-2", "2027-02-32", "février 2027"]) expect(startDate.safeParse(bad).success).toBe(false);
    expect(JSON.stringify(z.toJSONSchema(startDate))).not.toContain('"format"');
  });

  test("isIncompleteDate : seule l'année", () => {
    expect(isIncompleteDate("2022")).toBe(true);
    expect(isIncompleteDate("2022-03")).toBe(false);
    expect(isIncompleteDate(null)).toBe(false);
    expect(isIncompleteDate(undefined)).toBe(false);
  });
});

describe("draftWarnings", () => {
  test("dates à l'année, résumé et disponibilités absents", () => {
    const draft = ProfileDraftSchema.parse({
      experiences: [{ title: "Serveuse", company: "Café du Port", start: "2022", end: "2024" }],
      education: [{ degree: "Master", school: "Université de Bordeaux", start: "2023-09", end: "2025" }],
    });
    expect(draftWarnings(draft)).toEqual({
      incompleteDates: [
        "Serveuse — Café du Port : début 2022",
        "Serveuse — Café du Port : fin 2024",
        "Master — Université de Bordeaux : fin 2025",
      ],
      missingSummary: true,
      missingAvailability: true,
    });
  });

  test("brouillon complet : aucun avertissement", () => {
    const draft = ProfileDraftSchema.parse({
      summary: "Accroche du CV",
      availability: { contractTypes: ["pfe-internship"], startDate: "2027-02" },
      experiences: [{ title: "Dev", company: "Acme", start: "2024-09", end: null }],
    });
    expect(draftWarnings(draft)).toEqual({ incompleteDates: [], missingSummary: false, missingAvailability: false });
  });
});
