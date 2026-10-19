import { describe, expect, test } from "bun:test";
import { z } from "zod";
import { cleanProfileInput } from "@/lib/profile/clean";
import { AvailabilitySchema, ExperienceSchema, isIncompleteDate, ProfileSchema } from "@/lib/schemas/profile";

const experience = (start: string, end: string | null, achievements: string[] = ["x"]) => ({
  id: "exp-test",
  title: "Dev",
  company: "Acme",
  type: "cdi",
  start,
  end,
  achievements,
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
    for (const ok of ["2027", "2027-02", "2027-02-15", undefined]) expect(startDate.safeParse(ok).success).toBe(true);
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

describe("règles assouplies (étape 6)", () => {
  test("réalisations vides acceptées (signalées par un avertissement, jamais inventées)", () => {
    expect(ExperienceSchema.safeParse(experience("2022", "2024", [])).success).toBe(true);
  });

  test("disponibilité : seul le type de contrat est obligatoire", () => {
    expect(AvailabilitySchema.safeParse({ contractTypes: ["internship"] }).success).toBe(true);
    const missing = AvailabilitySchema.safeParse({});
    expect(missing.success).toBe(false);
    expect(AvailabilitySchema.safeParse({ contractTypes: [] }).error?.issues[0].message).toBe("Choisis au moins un type de contrat");
  });

  test("messages en français pour le formulaire", () => {
    const result = ProfileSchema.safeParse(
      cleanProfileInput({
        identity: { firstName: "", lastName: "Dubois", headline: "Data" },
        contact: { email: "pas-un-mail", linkedin: "" },
        summary: "",
        availability: { contractTypes: ["internship"] },
        experiences: [{ id: "exp-a", title: "Dev", company: "Acme", type: "", start: "", end: null, achievements: [], skills: [] }],
        education: [],
        skills: [],
        languages: [],
      }),
    );
    const messages = Object.fromEntries((result.error?.issues ?? []).map((issue) => [issue.path.join("."), issue.message]));
    expect(messages).toMatchObject({
      "identity.firstName": "Champ obligatoire",
      "contact.email": "Adresse e-mail invalide",
      summary: "Champ obligatoire",
      "experiences.0.type": "Choisis un type d'expérience",
      "experiences.0.start": "Date obligatoire (AAAA ou AAAA-MM)",
    });
    // Un champ facultatif vide (linkedin: "") n'est pas une erreur.
    expect(messages["contact.linkedin"]).toBeUndefined();
  });
});

describe("cleanProfileInput", () => {
  test("chaînes vides et nombres non saisis retirés, valeurs gardées, listes filtrées", () => {
    expect(
      cleanProfileInput({ a: "", b: "  x  ", c: Number.NaN, d: 6, e: ["", " y ", ""], f: null, g: false, h: { i: "" } }),
    ).toEqual({ b: "x", d: 6, e: ["y"], f: null, g: false, h: {} });
  });
});
