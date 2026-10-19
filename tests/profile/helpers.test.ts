import { describe, expect, test } from "bun:test";
import { draftToFormValues, OTHER_SKILLS_CATEGORY, profileToFormValues, syncSkillsIntoGroups, type ProfileFormValues } from "@/lib/profile/form-values";
import { ensureIds, slugify, uniqueId } from "@/lib/profile/ids";
import { educationLabel, experienceLabel, periodLabel, projectLabel } from "@/lib/profile/labels";
import { mergeProjectIntoExperience } from "@/lib/profile/merge";
import { profileWarnings } from "@/lib/profile/warnings";
import { cleanProfileInput } from "@/lib/profile/clean";
import { ProfileDraftSchema, ProfileSchema } from "@/lib/schemas/profile";

// Cas réel : le modèle avait dupliqué des stages en expérience ET en projet, avec les compétences côté projet.
const draft = ProfileDraftSchema.parse({
  identity: { firstName: "Léa", lastName: "Dubois", headline: "Data scientist junior" },
  contact: { email: "lea@example.com" },
  availability: { contractTypes: ["pfe-internship"] },
  experiences: [
    { id: "exp-talan-2025", title: "Stagiaire data", company: "Talan", type: "internship", start: "2025-02", end: "2025-07", achievements: [], skills: [] },
    { id: "exp-talan-2025", title: "Serveuse", company: "Café du Port", type: "part-time", start: "2022", end: "2024" },
  ],
  projects: [
    { name: "Plateforme de scoring Talan", summary: "Pipeline de scoring", achievements: ["API de scoring en FastAPI", "Tableau de bord Power BI"], skills: ["Python", "FastAPI", " power bi "] },
  ],
  education: [{ degree: "Master Data Science", school: "Université de Bordeaux", start: "2023", end: "2025" }],
  skills: [{ category: "Langages", items: ["Python", "Power BI"] }],
  languages: [{ name: "Anglais", level: "C1" }],
});

describe("ids et libellés", () => {
  test("slugify : accents retirés, kebab-case", () => {
    expect(slugify("Café du Port — 2022")).toBe("cafe-du-port-2022");
  });

  test("uniqueId et ensureIds : ids en double ou absents régénérés", () => {
    const taken = new Set(["exp-talan-2025"]);
    expect(uniqueId("exp", ["Talan", "2025"], taken)).toBe("exp-talan-2025-2");
    const ids = ensureIds([{ id: "ok" }, { id: "ok" }, { id: "Mal Formé" }, {}], "x", () => ["a"], new Set()).map((i) => i.id);
    expect(ids).toEqual(["ok", "x-a", "x-a-2", "x-a-3"]);
  });

  test("libellés lisibles pour les sources (jamais l'id brut)", () => {
    expect(experienceLabel({ type: "internship", company: "Talan", start: "2025-02", end: "2025-07" })).toBe("Stage Talan, 2025");
    expect(experienceLabel({ type: "apprenticeship", company: "Banque Atlantique", start: "2024-09", end: null })).toBe("Alternance Banque Atlantique, depuis 2024");
    expect(experienceLabel({ type: "part-time", company: "Café du Port", start: "2022", end: "2024" })).toBe("Temps partiel Café du Port, 2022 – 2024");
    expect(projectLabel({ name: "Chatbot RAG" })).toBe("Projet Chatbot RAG");
    expect(educationLabel({ degree: "Master Data Science", school: "Université de Bordeaux", start: "2023", end: "2025" })).toBe(
      "Master Data Science, Université de Bordeaux, 2023 – 2025",
    );
    expect(periodLabel(undefined, undefined)).toBe("");
  });
});

describe("draftToFormValues", () => {
  const values = draftToFormValues(draft);

  test("rien d'inventé : champs absents vides, ids en double corrigés", () => {
    expect(values.summary).toBe("");
    expect(values.contact.phone).toBe("");
    expect(values.availability).toMatchObject({ contractTypes: ["pfe-internship"], startDate: "", durationMonths: undefined, acceptsRemote: undefined });
    expect(values.experiences.map((e) => e.id)).toEqual(["exp-talan-2025", "exp-cafe-du-port-2022"]);
    expect(values.projects?.[0].id).toBe("proj-plateforme-de-scoring-talan");
  });

  test("fin absente ≠ en cours : '' (à compléter) contre null (poste actuel)", () => {
    const withCurrent = draftToFormValues(ProfileDraftSchema.parse({ experiences: [{ title: "a", company: "b", end: null }, { title: "c", company: "d" }] }));
    expect(withCurrent.experiences.map((e) => e.end)).toEqual([null, ""]);
  });

  test("un profil enregistré se recharge dans le formulaire sans perte", () => {
    const saved = ProfileSchema.parse(
      cleanProfileInput({ ...syncSkillsIntoGroups(values).values, summary: "Résumé écrit par Léa.", experiences: values.experiences.map((e) => ({ ...e, type: e.type })) }),
    );
    expect(ProfileSchema.parse(cleanProfileInput(profileToFormValues(saved)))).toEqual(saved);
  });
});

describe("mergeProjectIntoExperience", () => {
  test("réalisations et compétences ajoutées sans doublon, description reprise, projet retiré", () => {
    const values = draftToFormValues(draft);
    const merged = mergeProjectIntoExperience({ ...values, experiences: [{ ...values.experiences[0], skills: ["Python"] }, values.experiences[1]] }, 0, 0);
    expect(merged.projects).toEqual([]);
    expect(merged.experiences[0]).toMatchObject({
      achievements: ["API de scoring en FastAPI", "Tableau de bord Power BI"],
      skills: ["Python", "FastAPI", " power bi "],
      summary: "Pipeline de scoring",
    });
    expect(merged.experiences[1]).toEqual(values.experiences[1]);
  });

  test("indices invalides : rien ne change", () => {
    const values = draftToFormValues(draft);
    expect(mergeProjectIntoExperience(values, 5, 0)).toBe(values);
  });
});

describe("syncSkillsIntoGroups", () => {
  test("compétences des expériences et projets absentes des groupes ajoutées à « Autres compétences »", () => {
    const { values, added } = syncSkillsIntoGroups(draftToFormValues(draft));
    expect(added).toEqual(["FastAPI"]); // " power bi " correspond déjà à « Power BI »
    expect(values.skills.at(-1)).toEqual({ category: OTHER_SKILLS_CATEGORY, items: ["FastAPI"] });
  });

  test("rien à ajouter : valeurs inchangées", () => {
    const values: ProfileFormValues = { ...draftToFormValues(draft), projects: [] };
    expect(syncSkillsIntoGroups(values).added).toEqual([]);
  });
});

describe("profileWarnings", () => {
  test("disponibilité, réalisations, compétences vides et dates à l'année signalées", () => {
    const messages = profileWarnings(draftToFormValues(draft)).map((w) => `${w.field} | ${w.message}`);
    expect(messages).toEqual([
      "availability.durationMonths | Disponibilité : durée non renseignée.",
      "availability.startDate | Disponibilité : date de début non renseignée.",
      "availability.mobility.cities | Disponibilité : mobilité non renseignée (villes ou pays).",
      "availability.acceptsRemote | Disponibilité : télétravail non précisé.",
      "experiences.0.achievements | Stage Talan, 2025 : aucune réalisation.",
      "experiences.0.skills | Stage Talan, 2025 : aucune compétence.",
      "experiences.1.achievements | Temps partiel Café du Port, 2022 – 2024 : aucune réalisation.",
      "experiences.1.skills | Temps partiel Café du Port, 2022 – 2024 : aucune compétence.",
      "experiences.1.start | Temps partiel Café du Port, 2022 – 2024 : début 2022, mois à préciser ?",
      "experiences.1.end | Temps partiel Café du Port, 2022 – 2024 : fin 2024, mois à préciser ?",
      "education.0.start | Master Data Science, Université de Bordeaux, 2023 – 2025 : début 2023, mois à préciser ?",
      "education.0.end | Master Data Science, Université de Bordeaux, 2023 – 2025 : fin 2025, mois à préciser ?",
    ]);
  });
});
