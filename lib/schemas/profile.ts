import { z } from "zod";

// Messages d'erreur Zod en français par défaut (formulaire du profil, et relances envoyées au modèle).
z.config(z.locales.fr());

// Les .describe() sont repris dans le JSON Schema envoyé au LLM (certains modèles ignorent "pattern").
// Dates à la précision de la source : un CV qui ne donne que l'année ne doit pas forcer un mois inventé.
const yearMonth = z
  .string("Date obligatoire (AAAA ou AAAA-MM)")
  .regex(/^\d{4}(-(0[1-9]|1[0-2]))?$/, "Format attendu : AAAA ou AAAA-MM (ex. 2024 ou 2024-09)")
  .describe("YYYY, or YYYY-MM only if the month is written in the source. Never add a month that is not written.");

/** Date réduite à l'année (YYYY) : le formulaire la signale pour que l'utilisateur la précise ou la confirme. */
export const isIncompleteDate = (date: string | null | undefined) => typeof date === "string" && /^\d{4}$/.test(date);

const id = z
  .string()
  .regex(/^[a-z0-9-]+$/, "Format attendu : kebab-case")
  .describe("Unique kebab-case identifier, e.g. exp-acme-2023");

/** Comparaison des compétences insensible à la casse et aux espaces ("Node JS" == "nodejs"). */
export const normalizeSkill = (skill: string) => skill.toLowerCase().replace(/\s+/g, "");

// Messages affichés dans le formulaire du profil.
// Un champ vide arrive absent (cf. cleanProfileInput) : même message pour « absent » et « vide ».
const required = () => z.string("Champ obligatoire").trim().min(1, "Champ obligatoire");

export const EXPERIENCE_TYPES = ["cdi", "cdd", "freelance", "internship", "apprenticeship", "part-time", "other"] as const;
export const CONTRACT_TYPES = ["pfe-internship", "internship", "cdi", "cdd", "freelance", "apprenticeship", "part-time"] as const;
export const LANGUAGE_LEVELS = ["native", "C2", "C1", "B2", "B1", "A2", "A1"] as const;

export const ExperienceSchema = z.object({
  id,
  title: required(),
  company: required(),
  location: z.string().optional(),
  type: z.enum(EXPERIENCE_TYPES, "Choisis un type d'expérience"),
  start: yearMonth,
  end: yearMonth.nullable(), // null = poste actuel
  summary: z.string().optional(),
  // Peut être vide (un job étudiant sans résultat notable) : signalé par un avertissement, jamais inventé.
  achievements: z.array(z.string().min(1)),
  skills: z.array(z.string().min(1)),
});

export const ProjectSchema = z.object({
  id,
  name: required(),
  role: z.string().optional(),
  url: z.url("URL invalide (https://…)").optional(),
  start: yearMonth.optional(),
  end: yearMonth.nullable().optional(),
  summary: required(),
  achievements: z.array(z.string().min(1)),
  skills: z.array(z.string().min(1)),
});

export const EducationSchema = z.object({
  id,
  degree: required(),
  school: required(),
  location: z.string().optional(),
  start: yearMonth.optional(),
  end: yearMonth.nullable(),
  details: z.array(z.string()).default([]),
});

export const SkillGroupSchema = z.object({
  category: required(),
  items: z.array(z.string().min(1)).min(1, "Ajoute au moins une compétence"),
});

export const LanguageSchema = z.object({
  name: required(),
  level: z.enum(LANGUAGE_LEVELS, "Choisis un niveau"),
});

/** Seul le type de contrat est obligatoire ; le reste est facultatif et signalé par des avertissements. */
export const AvailabilitySchema = z.object({
  contractTypes: z.array(z.enum(CONTRACT_TYPES)).min(1, "Choisis au moins un type de contrat"),
  durationMonths: z.number("Nombre de mois").int("Nombre entier de mois").positive("Durée positive").optional(), // ex. 6 pour un stage PFE
  // Une seule regex, sans format "date" : avec une union [iso.date, YYYY-MM], le modèle (Gemini, au début du projet) privilégiait la date
  // complète et inventait le jour ("février 2027" -> 2027-02-02).
  startDate: z
    .string()
    .regex(/^\d{4}(-(0[1-9]|1[0-2])(-(0[1-9]|[12]\d|3[01]))?)?$/, "Format attendu : YYYY, YYYY-MM ou YYYY-MM-DD")
    .describe("YYYY, YYYY-MM or YYYY-MM-DD, exactly as precise as written. Never add a month or a day that is not written.")
    .optional(),
  mobility: z
    .object({
      countries: z.array(z.string().min(1)).default([]),
      cities: z.array(z.string().min(1)).default([]),
    })
    .default({ countries: [], cities: [] }),
  acceptsRemote: z.boolean().optional(),
});

export const IdentitySchema = z.object({
  firstName: required(),
  lastName: required(),
  headline: required().describe("Short professional title, e.g. Full-stack TypeScript developer"),
});

const url = () => z.url("URL invalide (https://…)");

export const ContactSchema = z.object({
  email: z.email("Adresse e-mail invalide"),
  phone: z.string().optional(),
  city: z.string().optional(),
  linkedin: url().optional(),
  github: url().optional(),
  website: url().optional(),
});

export const ProfileSchema = z
  .object({
    identity: IdentitySchema,
    contact: ContactSchema,
    summary: required(),
    availability: AvailabilitySchema,
    experiences: z.array(ExperienceSchema),
    projects: z.array(ProjectSchema).default([]),
    education: z.array(EducationSchema),
    skills: z.array(SkillGroupSchema),
    languages: z.array(LanguageSchema),
    interests: z.array(z.string()).default([]),
  })
  .superRefine((profile, ctx) => {
    // Les ids sont référencés par matchProfile : ils doivent être uniques.
    const seen = new Set<string>();
    const sections = ["experiences", "projects", "education"] as const;
    for (const section of sections) {
      profile[section].forEach((item, index) => {
        if (seen.has(item.id)) {
          ctx.addIssue({ code: "custom", path: [section, index, "id"], message: `id dupliqué : "${item.id}"` });
        }
        seen.add(item.id);
      });
    }

    // Toute compétence citée dans une expérience ou un projet doit figurer dans la liste globale.
    const known = new Set(profile.skills.flatMap((group) => group.items.map(normalizeSkill)));
    for (const section of ["experiences", "projects"] as const) {
      profile[section].forEach((item, index) => {
        item.skills.forEach((skill, skillIndex) => {
          if (!known.has(normalizeSkill(skill))) {
            ctx.addIssue({
              code: "custom",
              path: [section, index, "skills", skillIndex],
              message: `« ${skill} » doit aussi figurer dans les compétences du profil`,
            });
          }
        });
      });
    }
  });

/**
 * Schéma cible de l'extraction d'un CV, envoyé au LLM (JSON Schema) pour le guider : mêmes types, enums
 * et formats que ProfileSchema, mais tout ce qu'un CV peut ne pas contenir est facultatif, pour que le
 * modèle n'ait jamais à inventer (ex. disponibilités). Sans .catch() ni .default() : ils rendraient le
 * JSON Schema permissif. La réponse validée est ensuite passée à ProfileDraftSchema.
 */
export const ProfileTargetSchema = z.object({
  identity: IdentitySchema.partial(),
  contact: ContactSchema.partial(),
  summary: z.string().min(1).optional(),
  availability: AvailabilitySchema.partial()
    .extend({
      mobility: z
        .object({ countries: z.array(z.string().min(1)), cities: z.array(z.string().min(1)) })
        .partial()
        .optional(),
    })
    .optional(),
  experiences: z.array(ExperienceSchema.partial().required({ title: true, company: true })),
  projects: z.array(ProjectSchema.partial().required({ name: true })),
  education: z.array(
    EducationSchema.partial().required({ degree: true, school: true }).extend({ details: z.array(z.string()).optional() }),
  ),
  skills: z.array(SkillGroupSchema),
  languages: z.array(LanguageSchema.partial().required({ name: true })),
  interests: z.array(z.string()).optional(),
});

/**
 * Brouillon issu de l'extraction LLM d'un CV : tout est facultatif et les valeurs mal formées
 * (dates, enums, URLs) sont tolérées, pour que l'utilisateur les corrige dans le formulaire
 * avant validation par ProfileSchema.
 */
type ContractType = z.infer<typeof AvailabilitySchema>["contractTypes"][number];

const looseString =z.string().optional().catch(undefined);
const looseList = z.array(z.string()).default([]).catch([]);

const lenientItem = {
  id: looseString,
  location: looseString,
  start: looseString,
  end: z.string().nullable().optional().catch(undefined),
};

export const ProfileDraftSchema = z.object({
  identity: z
    .object({ firstName: looseString, lastName: looseString, headline: looseString })
    .default({}),
  contact: z
    .object({
      email: looseString,
      phone: looseString,
      city: looseString,
      linkedin: looseString,
      github: looseString,
      website: looseString,
    })
    .default({}),
  summary: looseString,
  availability: z
    .object({
      contractTypes: z
        .array(z.string())
        .default([])
        .catch([])
        .transform((types) =>
          types.filter((t): t is ContractType => AvailabilitySchema.shape.contractTypes.element.safeParse(t).success),
        ),
      durationMonths: z.number().optional().catch(undefined),
      startDate: looseString,
      mobility: z.object({ countries: looseList, cities: looseList }).default({ countries: [], cities: [] }),
      acceptsRemote: z.boolean().optional().catch(undefined),
    })
    .default({ contractTypes: [], mobility: { countries: [], cities: [] } }),
  experiences: z
    .array(
      ExperienceSchema.partial().extend({
        ...lenientItem,
        type: ExperienceSchema.shape.type.optional().catch(undefined),
        achievements: looseList,
        skills: looseList,
      }),
    )
    .default([]),
  projects: z
    .array(
      ProjectSchema.partial().extend({
        ...lenientItem,
        url: looseString,
        achievements: looseList,
        skills: looseList,
      }),
    )
    .default([]),
  education: z.array(EducationSchema.partial().extend({ ...lenientItem, details: looseList })).default([]),
  skills: z.array(z.object({ category: z.string().default(""), items: looseList })).default([]),
  languages: z
    .array(z.object({ name: z.string(), level: LanguageSchema.shape.level.optional().catch(undefined) }))
    .default([]),
  interests: looseList,
});

export type Profile = z.infer<typeof ProfileSchema>;
export type ProfileDraft = z.infer<typeof ProfileDraftSchema>;
export type Experience = z.infer<typeof ExperienceSchema>;
export type Project = z.infer<typeof ProjectSchema>;
export type Availability = z.infer<typeof AvailabilitySchema>;
