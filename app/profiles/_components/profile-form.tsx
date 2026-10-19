"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { useEffect, useMemo, useRef, useState, useSyncExternalStore, useTransition, type ReactNode } from "react";
import {
  Controller,
  FormProvider,
  get,
  useFieldArray,
  useForm,
  useFormContext,
  useWatch,
  type FieldErrors,
  type Resolver,
} from "react-hook-form";
import { saveProfileAction, type SaveProfileResult } from "@/app/profiles/actions";
import { ChipsInput, Field, fieldId, LinesInput, selectClassName } from "@/app/profiles/_components/fields";
import { Reveal } from "@/components/motion/reveal";
import { useReducedMotion } from "@/components/motion/use-reduced-motion";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { cleanProfileInput } from "@/lib/profile/clean";
import { syncSkillsIntoGroups, type ProfileFormValues } from "@/lib/profile/form-values";
import { uniqueId } from "@/lib/profile/ids";
import {
  CONTRACT_TYPE_LABELS,
  EXPERIENCE_TYPE_LABELS,
  experienceLabel,
  LANGUAGE_LEVEL_LABELS,
  projectLabel,
} from "@/lib/profile/labels";
import { mergeProjectIntoExperience } from "@/lib/profile/merge";
import { profileWarnings } from "@/lib/profile/warnings";
import { CONTRACT_TYPES, EXPERIENCE_TYPES, LANGUAGE_LEVELS, ProfileSchema, type Profile } from "@/lib/schemas/profile";

export type ProfileFormTarget = { importId: string } | { profileId: string };

// Les champs vides deviennent absents avant validation (cf. cleanProfileInput) ; les chemins d'erreur restent identiques.
const baseResolver = zodResolver(ProfileSchema);
const resolver: Resolver<ProfileFormValues, unknown, Profile> = (values, context, options) =>
  baseResolver(cleanProfileInput(values) as ProfileFormValues, context, options);

type Issue = { path: string; message: string };

function collectErrors(errors: FieldErrors, prefix = ""): Issue[] {
  const issues: Issue[] = [];
  for (const [key, value] of Object.entries(errors)) {
    if (!value || key === "ref") continue;
    const path = prefix ? `${prefix}.${key}` : key;
    if (typeof value.message === "string" && value.message) issues.push({ path, message: value.message });
    else if (typeof value === "object") issues.push(...collectErrors(value as FieldErrors, path));
  }
  return issues;
}

const DATE_HINT = "AAAA ou AAAA-MM, à la précision de ton CV";

export function ProfileForm({ defaultValues, target }: { defaultValues: ProfileFormValues; target: ProfileFormTarget }) {
  const form = useForm<ProfileFormValues, unknown, Profile>({ resolver, defaultValues, mode: "onTouched" });
  const [pending, startTransition] = useTransition();
  const [serverError, setServerError] = useState<SaveProfileResult | null>(null);
  const [addedSkills, setAddedSkills] = useState<string[]>([]);
  const reduced = useReducedMotion();
  const storageKey = `lmagent:profile-form:${"importId" in target ? `import-${target.importId}` : `profile-${target.profileId}`}`;
  const localDraft = useLocalDraft(storageKey, form);

  const values = useWatch({ control: form.control }) as ProfileFormValues;
  const warnings = useMemo(() => profileWarnings(values), [values]);
  const errors = collectErrors(form.formState.errors);

  function goTo(path: string) {
    const element = document.querySelector<HTMLElement>(`[data-field="${path}"]`) ?? document.getElementById(fieldId(path));
    element?.scrollIntoView({ behavior: reduced ? "auto" : "smooth", block: "center" });
    element?.querySelector<HTMLElement>("input, textarea, select, button")?.focus({ preventScroll: true });
  }

  function onSave() {
    setServerError(null);
    const synced = syncSkillsIntoGroups(form.getValues());
    if (synced.added.length) {
      form.setValue("skills", synced.values.skills, { shouldDirty: true });
      setAddedSkills(synced.added);
    }
    void form.handleSubmit(
      (data) =>
        startTransition(async () => {
          localDraft.clear();
          const result = await saveProfileAction(target, data);
          if (!result) return;
          setServerError(result);
          for (const issue of result.issues ?? []) form.setError(issue.path as never, { message: issue.message });
        }),
      () => window.scrollTo({ top: 0, behavior: reduced ? "auto" : "smooth" }),
    )();
  }

  return (
    <FormProvider {...form}>
      <form
        noValidate
        onSubmit={(event) => {
          event.preventDefault();
          onSave();
        }}
        className="flex flex-col gap-6"
      >
        {localDraft.available && (
          <Alert>
            <AlertTitle>Brouillon non enregistré</AlertTitle>
            <AlertDescription>
              <p>Des modifications de ce formulaire ont été gardées dans ce navigateur{localDraft.savedAt ? ` (${localDraft.savedAt})` : ""}.</p>
              <div className="mt-2 flex flex-wrap gap-2">
                <Button type="button" size="sm" onClick={localDraft.restore}>
                  Reprendre le brouillon
                </Button>
                <Button type="button" size="sm" variant="outline" onClick={localDraft.dismiss}>
                  Ignorer
                </Button>
              </div>
            </AlertDescription>
          </Alert>
        )}

        {(errors.length > 0 || serverError) && (
          <Alert variant="destructive">
            <AlertTitle>{serverError?.error ?? "Le profil contient des erreurs : corrige les champs signalés."}</AlertTitle>
            {errors.length > 0 && (
              <AlertDescription>
                <IssueList issues={errors} onSelect={goTo} />
              </AlertDescription>
            )}
          </Alert>
        )}

        {warnings.length > 0 && (
          <details className="rounded-lg border bg-card px-4 py-3 text-sm" open>
            <summary className="cursor-pointer font-medium">
              À compléter de préférence ({warnings.length}) · n&apos;empêche pas l&apos;enregistrement
            </summary>
            <div className="mt-2 max-h-56 overflow-auto" data-lenis-prevent>
              <IssueList issues={warnings.map((w) => ({ path: w.field, message: w.message }))} onSelect={goTo} tone="warning" />
            </div>
          </details>
        )}

        <Reveal className="flex flex-col gap-6">
          <IdentitySection />
          <AvailabilitySection />
          <ExperiencesSection />
          <ProjectsSection />
          <EducationSection />
          <SkillsSection addedSkills={addedSkills} />
          <LanguagesSection />
        </Reveal>

        <div className="sticky bottom-0 z-10 -mx-4 flex flex-wrap items-center gap-3 border-t bg-background/95 px-4 py-3 backdrop-blur">
          <Button type="submit" disabled={pending}>
            {pending ? "Enregistrement…" : "Enregistrer le profil"}
          </Button>
          <span className="text-sm text-muted-foreground">
            {warnings.length > 0 ? `${warnings.length} point${warnings.length > 1 ? "s" : ""} à compléter de préférence` : "Profil complet"}
          </span>
        </div>
      </form>
    </FormProvider>
  );
}

function IssueList({ issues, onSelect, tone }: { issues: Issue[]; onSelect: (path: string) => void; tone?: "warning" }) {
  return (
    <ul className="flex flex-col gap-1">
      {issues.map((issue, index) => (
        <li key={`${issue.path}-${index}`}>
          <button
            type="button"
            onClick={() => onSelect(issue.path)}
            className={tone === "warning" ? "text-left underline-offset-2 hover:underline" : "text-left underline underline-offset-2"}
          >
            {issue.message}
          </button>
        </li>
      ))}
    </ul>
  );
}

const noopSubscribe = () => () => {};

/** Sauvegarde locale (ce navigateur seulement) pour ne rien perdre en cas de rechargement. */
function useLocalDraft(key: string, form: ReturnType<typeof useForm<ProfileFormValues, unknown, Profile>>) {
  // Brouillon présent à l'ouverture de la page (lu une seule fois ; l'autosave ne doit pas faire réapparaître le bandeau).
  const initial = useRef<string | null | undefined>(undefined);
  const raw = useSyncExternalStore(
    noopSubscribe,
    () => {
      if (initial.current === undefined) {
        try {
          initial.current = localStorage.getItem(key);
        } catch {
          initial.current = null;
        }
      }
      return initial.current;
    },
    () => null,
  );
  const [handled, setHandled] = useState(false);
  const stored = useMemo(() => {
    if (!raw || handled) return null;
    try {
      return JSON.parse(raw) as { savedAt: number; values: ProfileFormValues };
    } catch {
      return null;
    }
  }, [raw, handled]);
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const paused = useRef(false);

  useEffect(() => {
    const subscription = form.watch((values) => {
      if (paused.current) return;
      clearTimeout(timer.current);
      timer.current = setTimeout(() => {
        try {
          localStorage.setItem(key, JSON.stringify({ savedAt: Date.now(), values }));
        } catch {
          // Quota dépassé ou stockage bloqué : sans conséquence pour l'enregistrement en base.
        }
      }, 600);
    });
    return () => {
      subscription.unsubscribe();
      clearTimeout(timer.current);
    };
  }, [key, form]);

  const remove = () => {
    try {
      localStorage.removeItem(key);
    } catch {}
  };

  return {
    available: stored !== null,
    savedAt: stored ? new Date(stored.savedAt).toLocaleString("fr-FR", { dateStyle: "short", timeStyle: "short" }) : null,
    restore() {
      if (stored) form.reset(stored.values, { keepDefaultValues: true });
      setHandled(true);
    },
    dismiss() {
      remove();
      setHandled(true);
    },
    clear() {
      paused.current = true;
      clearTimeout(timer.current);
      remove();
    },
  };
}

// ---------------------------------------------------------------------------------------------------------------
// Sections

function Section({ title, description, children, action }: { title: string; description?: string; children: ReactNode; action?: ReactNode }) {
  return (
    <Card>
      <CardHeader className="flex flex-row flex-wrap items-start justify-between gap-3">
        <div className="flex flex-col gap-1">
          <CardTitle className="font-heading text-2xl font-normal">{title}</CardTitle>
          {description && <CardDescription>{description}</CardDescription>}
        </div>
        {action}
      </CardHeader>
      <CardContent className="flex flex-col gap-4">{children}</CardContent>
    </Card>
  );
}

const grid = "grid grid-cols-1 gap-4 sm:grid-cols-2";

function useFieldError(name: string): string | undefined {
  const { formState } = useFormContext<ProfileFormValues>();
  return get(formState.errors, name)?.message;
}

function TextField({ name, label, hint, type = "text", placeholder }: { name: string; label: string; hint?: string; type?: string; placeholder?: string }) {
  const { register } = useFormContext<ProfileFormValues>();
  const error = useFieldError(name);
  return (
    <Field name={name} label={label} hint={hint} error={error}>
      <Input id={fieldId(name)} type={type} placeholder={placeholder} aria-invalid={error ? true : undefined} {...register(name as never)} />
    </Field>
  );
}

function LinesField({ name, label, hint, placeholder }: { name: string; label: string; hint?: string; placeholder?: string }) {
  const { control } = useFormContext<ProfileFormValues>();
  const error = useFieldError(name);
  return (
    <Field name={name} label={label} hint={hint} error={error}>
      <Controller
        control={control}
        name={name as never}
        render={({ field }) => (
          <LinesInput id={fieldId(name)} value={(field.value as string[]) ?? []} onChange={field.onChange} onBlur={field.onBlur} placeholder={placeholder} invalid={!!error} />
        )}
      />
    </Field>
  );
}

function ChipsField({ name, label, hint, placeholder }: { name: string; label: string; hint?: string; placeholder?: string }) {
  const { control, formState } = useFormContext<ProfileFormValues>();
  const error = get(formState.errors, name)?.message ?? firstNestedError(formState.errors, name);
  return (
    <Field name={name} label={label} hint={hint} error={error}>
      <Controller
        control={control}
        name={name as never}
        render={({ field }) => (
          <ChipsInput id={fieldId(name)} value={(field.value as string[]) ?? []} onChange={field.onChange} placeholder={placeholder} invalid={!!error} />
        )}
      />
    </Field>
  );
}

/** Erreur portée par un élément d'une liste (ex. skills.2 : compétence absente des groupes). */
function firstNestedError(errors: FieldErrors, name: string): string | undefined {
  const node = get(errors, name);
  if (!node || typeof node !== "object") return undefined;
  for (const value of Object.values(node as Record<string, { message?: string }>)) {
    if (value && typeof value.message === "string") return value.message;
  }
  return undefined;
}

/** Date de fin avec « En cours » (null) ; vide = fin inconnue, à compléter. */
function EndDateField({ name, label, nullable = true }: { name: string; label: string; nullable?: boolean }) {
  const { control } = useFormContext<ProfileFormValues>();
  const error = useFieldError(name);
  return (
    <Controller
      control={control}
      name={name as never}
      render={({ field }) => {
        const current = field.value === null;
        return (
          <Field name={name} label={label} hint={current ? undefined : DATE_HINT} error={error}>
            <Input
              id={fieldId(name)}
              value={current ? "" : ((field.value as string | undefined) ?? "")}
              disabled={current}
              placeholder={current ? "En cours" : "ex. 2025-06"}
              aria-invalid={error ? true : undefined}
              onChange={(event) => field.onChange(event.target.value)}
              onBlur={field.onBlur}
            />
            {nullable && (
              <label className="flex items-center gap-2 text-sm">
                <input type="checkbox" checked={current} onChange={(event) => field.onChange(event.target.checked ? null : "")} />
                En cours
              </label>
            )}
          </Field>
        );
      }}
    />
  );
}

function ListControls({ index, count, onMove, onRemove, label }: { index: number; count: number; onMove: (from: number, to: number) => void; onRemove: () => void; label: string }) {
  return (
    <div className="flex flex-wrap gap-1.5">
      <Button type="button" variant="outline" size="sm" disabled={index === 0} onClick={() => onMove(index, index - 1)} aria-label={`Monter ${label}`}>
        ↑
      </Button>
      <Button type="button" variant="outline" size="sm" disabled={index === count - 1} onClick={() => onMove(index, index + 1)} aria-label={`Descendre ${label}`}>
        ↓
      </Button>
      <Button type="button" variant="outline" size="sm" onClick={onRemove}>
        Supprimer
      </Button>
    </div>
  );
}

function takenIds(values: ProfileFormValues) {
  return new Set([...values.experiences, ...(values.projects ?? []), ...values.education].map((item) => item.id));
}

function IdentitySection() {
  const { register } = useFormContext<ProfileFormValues>();
  const summary = useWatch<ProfileFormValues, "summary">({ name: "summary" });
  const error = useFieldError("summary");
  return (
    <Section title="Identité et contact" description="Ce qui apparaîtra en tête de chaque lettre.">
      <div className={grid}>
        <TextField name="identity.firstName" label="Prénom" />
        <TextField name="identity.lastName" label="Nom" />
        <TextField name="identity.headline" label="Titre" hint="ex. Data scientist junior" />
        <TextField name="contact.email" label="E-mail" type="email" />
        <TextField name="contact.phone" label="Téléphone" type="tel" />
        <TextField name="contact.city" label="Ville" />
        <TextField name="contact.linkedin" label="LinkedIn" placeholder="https://www.linkedin.com/in/…" />
        <TextField name="contact.github" label="GitHub" placeholder="https://github.com/…" />
        <TextField name="contact.website" label="Site web" placeholder="https://…" />
      </div>
      <Field
        name="summary"
        label="Résumé"
        error={error}
        hint={summary?.trim() ? "Deux à quatre phrases sur ton profil et ce que tu cherches." : "Ton CV n'a pas de résumé : écris deux à quatre phrases sur ton profil et ce que tu cherches."}
      >
        <Textarea id={fieldId("summary")} rows={4} aria-invalid={error ? true : undefined} data-lenis-prevent {...register("summary")} />
      </Field>
    </Section>
  );
}

function AvailabilitySection() {
  const { control, register } = useFormContext<ProfileFormValues>();
  const contractError = useFieldError("availability.contractTypes");
  const durationError = useFieldError("availability.durationMonths");
  return (
    <Section title="Disponibilité" description="Seul le type de contrat est obligatoire ; le reste rend la lettre plus concrète.">
      <Field name="availability.contractTypes" label="Type de contrat recherché" error={contractError}>
        <Controller
          control={control}
          name="availability.contractTypes"
          render={({ field }) => (
            <div id={fieldId("availability.contractTypes")} className="flex flex-wrap gap-x-4 gap-y-2">
              {CONTRACT_TYPES.map((type) => (
                <label key={type} className="flex items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    checked={field.value.includes(type)}
                    onChange={(event) => field.onChange(event.target.checked ? [...field.value, type] : field.value.filter((t) => t !== type))}
                  />
                  {CONTRACT_TYPE_LABELS[type]}
                </label>
              ))}
            </div>
          )}
        />
      </Field>
      <div className={grid}>
        <Field name="availability.durationMonths" label="Durée (mois)" error={durationError}>
          <Input
            id={fieldId("availability.durationMonths")}
            type="number"
            min={1}
            inputMode="numeric"
            aria-invalid={durationError ? true : undefined}
            {...register("availability.durationMonths", { setValueAs: (v) => (v === "" || v === null ? undefined : Number(v)) })}
          />
        </Field>
        <TextField name="availability.startDate" label="À partir de" hint="AAAA, AAAA-MM ou AAAA-MM-JJ" placeholder="ex. 2027-02" />
        <ChipsField name="availability.mobility.cities" label="Villes" placeholder="Lyon, Paris…" />
        <ChipsField name="availability.mobility.countries" label="Pays" placeholder="France…" />
        <Field name="availability.acceptsRemote" label="Télétravail">
          <Controller
            control={control}
            name="availability.acceptsRemote"
            render={({ field }) => (
              <select
                id={fieldId("availability.acceptsRemote")}
                className={selectClassName}
                value={field.value === undefined ? "" : field.value ? "yes" : "no"}
                onChange={(event) => field.onChange(event.target.value === "" ? undefined : event.target.value === "yes")}
              >
                <option value="">Non précisé</option>
                <option value="yes">Accepté</option>
                <option value="no">Non souhaité</option>
              </select>
            )}
          />
        </Field>
      </div>
    </Section>
  );
}

function ExperiencesSection() {
  const { control, register, getValues, formState } = useFormContext<ProfileFormValues>();
  const { fields, append, remove, move } = useFieldArray({ control, name: "experiences", keyName: "key" });
  const items = useWatch<ProfileFormValues, "experiences">({ name: "experiences" });

  return (
    <Section
      title="Expériences"
      description="Stages, alternances, emplois et missions."
      action={
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() =>
            append({
              id: uniqueId("exp", ["nouvelle"], takenIds(getValues())),
              title: "",
              company: "",
              location: "",
              type: undefined as never,
              start: "",
              end: "",
              summary: "",
              achievements: [],
              skills: [],
            })
          }
        >
          Ajouter une expérience
        </Button>
      }
    >
      {fields.length === 0 && <p className="text-sm text-muted-foreground">Aucune expérience.</p>}
      {fields.map((field, i) => {
        const label = experienceLabel(items?.[i] ?? {});
        const typeError = get(formState.errors, `experiences.${i}.type`)?.message as string | undefined;
        return (
          <fieldset key={field.key} className="flex flex-col gap-4 rounded-md border bg-background/50 p-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <legend className="font-medium">{label}</legend>
              <ListControls index={i} count={fields.length} onMove={move} onRemove={() => remove(i)} label={label} />
            </div>
            <div className={grid}>
              <TextField name={`experiences.${i}.title`} label="Intitulé du poste" />
              <TextField name={`experiences.${i}.company`} label="Entreprise" />
              <Field name={`experiences.${i}.type`} label="Type" error={typeError}>
                <select id={fieldId(`experiences.${i}.type`)} className={selectClassName} aria-invalid={typeError ? true : undefined} {...register(`experiences.${i}.type`)}>
                  <option value="">Choisir…</option>
                  {EXPERIENCE_TYPES.map((type) => (
                    <option key={type} value={type}>
                      {EXPERIENCE_TYPE_LABELS[type]}
                    </option>
                  ))}
                </select>
              </Field>
              <TextField name={`experiences.${i}.location`} label="Lieu" />
              <TextField name={`experiences.${i}.start`} label="Début" hint={DATE_HINT} placeholder="ex. 2024-09" />
              <EndDateField name={`experiences.${i}.end`} label="Fin" />
            </div>
            <LinesField name={`experiences.${i}.achievements`} label="Réalisations" hint="Une par ligne, chiffrée si possible." placeholder="ex. Modèle de scoring de churn, +12 % de précision" />
            <ChipsField name={`experiences.${i}.skills`} label="Compétences mobilisées" hint="Entrée ou virgule pour ajouter." />
          </fieldset>
        );
      })}
    </Section>
  );
}

function ProjectsSection() {
  const { control, getValues, reset, register, formState } = useFormContext<ProfileFormValues>();
  const { fields, append, remove, move } = useFieldArray({ control, name: "projects", keyName: "key" });
  const items = useWatch<ProfileFormValues, "projects">({ name: "projects" });
  const experiences = useWatch<ProfileFormValues, "experiences">({ name: "experiences" });
  const [targets, setTargets] = useState<Record<string, string>>({});

  function merge(projectIndex: number, key: string) {
    const experienceIndex = Number(targets[key] ?? 0);
    reset(mergeProjectIntoExperience(getValues(), projectIndex, experienceIndex), { keepDefaultValues: true, keepErrors: false });
  }

  return (
    <Section
      title="Projets"
      description="Projets personnels, académiques ou open source. Un stage ou un emploi va dans Expériences."
      action={
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() =>
            append({ id: uniqueId("proj", ["nouveau"], takenIds(getValues())), name: "", role: "", url: "", start: "", end: "", summary: "", achievements: [], skills: [] })
          }
        >
          Ajouter un projet
        </Button>
      }
    >
      {fields.length === 0 && <p className="text-sm text-muted-foreground">Aucun projet.</p>}
      {fields.map((field, i) => {
        const label = projectLabel(items?.[i] ?? {});
        return (
          <fieldset key={field.key} className="flex flex-col gap-4 rounded-md border bg-background/50 p-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <legend className="font-medium">{label}</legend>
              <ListControls index={i} count={fields.length} onMove={move} onRemove={() => remove(i)} label={label} />
            </div>
            {(experiences?.length ?? 0) > 0 && (
              <div className="flex flex-wrap items-end gap-2 rounded-md bg-muted px-3 py-2 text-sm">
                <label className="flex min-w-0 flex-col gap-1">
                  <span>C&apos;est en fait une expérience ? Fusionner dans :</span>
                  <select
                    className={selectClassName}
                    value={targets[field.key] ?? "0"}
                    onChange={(event) => setTargets((current) => ({ ...current, [field.key]: event.target.value }))}
                  >
                    {experiences.map((experience, index) => (
                      <option key={experience.id} value={index}>
                        {experienceLabel(experience)}
                      </option>
                    ))}
                  </select>
                </label>
                <Button type="button" size="sm" variant="outline" onClick={() => merge(i, field.key)}>
                  Fusionner
                </Button>
              </div>
            )}
            <div className={grid}>
              <TextField name={`projects.${i}.name`} label="Nom du projet" />
              <TextField name={`projects.${i}.role`} label="Rôle" />
              <TextField name={`projects.${i}.url`} label="Lien" placeholder="https://…" />
              <TextField name={`projects.${i}.start`} label="Début" hint={DATE_HINT} />
              <EndDateField name={`projects.${i}.end`} label="Fin" />
            </div>
            <Field name={`projects.${i}.summary`} label="Description" error={get(formState.errors, `projects.${i}.summary`)?.message}>
              <Textarea id={fieldId(`projects.${i}.summary`)} rows={2} data-lenis-prevent {...register(`projects.${i}.summary`)} />
            </Field>
            <LinesField name={`projects.${i}.achievements`} label="Réalisations" hint="Une par ligne." />
            <ChipsField name={`projects.${i}.skills`} label="Compétences mobilisées" />
          </fieldset>
        );
      })}
    </Section>
  );
}

function EducationSection() {
  const { control, getValues } = useFormContext<ProfileFormValues>();
  const { fields, append, remove, move } = useFieldArray({ control, name: "education", keyName: "key" });
  const items = useWatch<ProfileFormValues, "education">({ name: "education" });
  return (
    <Section
      title="Formation"
      action={
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() => append({ id: uniqueId("edu", ["nouvelle"], takenIds(getValues())), degree: "", school: "", location: "", start: "", end: "", details: [] })}
        >
          Ajouter une formation
        </Button>
      }
    >
      {fields.length === 0 && <p className="text-sm text-muted-foreground">Aucune formation.</p>}
      {fields.map((field, i) => {
        const label = [items?.[i]?.degree, items?.[i]?.school].filter(Boolean).join(" — ") || "Formation";
        return (
          <fieldset key={field.key} className="flex flex-col gap-4 rounded-md border bg-background/50 p-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <legend className="font-medium">{label}</legend>
              <ListControls index={i} count={fields.length} onMove={move} onRemove={() => remove(i)} label={label} />
            </div>
            <div className={grid}>
              <TextField name={`education.${i}.degree`} label="Diplôme" />
              <TextField name={`education.${i}.school`} label="École ou université" />
              <TextField name={`education.${i}.location`} label="Lieu" />
              <TextField name={`education.${i}.start`} label="Début" hint={DATE_HINT} />
              <EndDateField name={`education.${i}.end`} label="Fin" />
            </div>
            <LinesField name={`education.${i}.details`} label="Détails" hint="Spécialité, mention, cours clés : un par ligne." />
          </fieldset>
        );
      })}
    </Section>
  );
}

function SkillsSection({ addedSkills }: { addedSkills: string[] }) {
  const { control } = useFormContext<ProfileFormValues>();
  const { fields, append, remove, move } = useFieldArray({ control, name: "skills", keyName: "key" });
  return (
    <Section
      title="Compétences"
      description="La liste complète, par catégorie. Les compétences d'une expérience doivent y figurer : elles y sont ajoutées automatiquement à l'enregistrement."
      action={
        <Button type="button" variant="outline" size="sm" onClick={() => append({ category: "", items: [] })}>
          Ajouter une catégorie
        </Button>
      }
    >
      {addedSkills.length > 0 && (
        <Alert>
          <AlertDescription>Ajoutées à « Autres compétences » car citées dans une expérience ou un projet : {addedSkills.join(", ")}.</AlertDescription>
        </Alert>
      )}
      {fields.map((field, i) => (
        <div key={field.key} className="grid grid-cols-1 gap-3 rounded-md border bg-background/50 p-4 sm:grid-cols-[minmax(0,14rem)_minmax(0,1fr)]">
          <TextField name={`skills.${i}.category`} label="Catégorie" />
          <div className="flex min-w-0 flex-col gap-2">
            <ChipsField name={`skills.${i}.items`} label="Compétences" />
            <ListControls index={i} count={fields.length} onMove={move} onRemove={() => remove(i)} label="cette catégorie" />
          </div>
        </div>
      ))}
    </Section>
  );
}

function LanguagesSection() {
  const { control, register, formState } = useFormContext<ProfileFormValues>();
  const { fields, append, remove, move } = useFieldArray({ control, name: "languages", keyName: "key" });
  const errors = formState.errors;
  return (
    <Section
      title="Langues et centres d'intérêt"
      action={
        <Button type="button" variant="outline" size="sm" onClick={() => append({ name: "", level: undefined as never })}>
          Ajouter une langue
        </Button>
      }
    >
      {fields.map((field, i) => {
        const levelError = get(errors, `languages.${i}.level`)?.message as string | undefined;
        return (
          <div key={field.key} className="grid grid-cols-1 items-start gap-3 sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto]">
            <TextField name={`languages.${i}.name`} label="Langue" />
            <Field name={`languages.${i}.level`} label="Niveau" error={levelError} hint="Laisse « Choisir » si ton CV ne le précise pas : à toi de l'indiquer.">
              <select id={fieldId(`languages.${i}.level`)} className={selectClassName} aria-invalid={levelError ? true : undefined} {...register(`languages.${i}.level`)}>
                <option value="">Choisir…</option>
                {LANGUAGE_LEVELS.map((level) => (
                  <option key={level} value={level}>
                    {LANGUAGE_LEVEL_LABELS[level]}
                  </option>
                ))}
              </select>
            </Field>
            <div className="sm:pt-6">
              <ListControls index={i} count={fields.length} onMove={move} onRemove={() => remove(i)} label="cette langue" />
            </div>
          </div>
        );
      })}
      <ChipsField name="interests" label="Centres d'intérêt" />
    </Section>
  );
}
