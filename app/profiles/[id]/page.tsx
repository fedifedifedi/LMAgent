import type { Metadata } from "next";
import { io } from "next/cache";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense, type ReactNode } from "react";
import { DeleteProfile } from "@/app/profiles/_components/delete-profile";
import { SavedNotice } from "@/app/profiles/_components/saved-notice";
import { Button, buttonVariants } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { db } from "@/lib/db";
import { profileCompleteness, profileTimeline, skillUsage, type TimelineEntry } from "@/lib/profile/completeness";
import { CONTRACT_TYPE_LABELS, EXPERIENCE_TYPE_LABELS, LANGUAGE_LEVEL_LABELS, periodLabel } from "@/lib/profile/labels";
import { getProfile } from "@/lib/repositories/profiles";
import { normalizeSkill, type Profile } from "@/lib/schemas/profile";

export const metadata: Metadata = { title: "Profil · LMAgent" };

export default function ProfilePage({ params, searchParams }: PageProps<"/profiles/[id]">) {
  return (
    <main className="mx-auto flex w-full max-w-5xl flex-col gap-6 px-4 py-10">
      <Suspense fallback={<p className="text-muted-foreground">Chargement du profil…</p>}>
        <ProfileView params={params} searchParams={searchParams} />
      </Suspense>
    </main>
  );
}

function Block({ title, description, children, className }: { title: string; description?: string; children: ReactNode; className?: string }) {
  return (
    <Card className={className}>
      <CardHeader>
        <CardTitle className="font-heading text-2xl font-normal">{title}</CardTitle>
        {description && <CardDescription>{description}</CardDescription>}
      </CardHeader>
      <CardContent className="flex flex-col gap-4 text-sm">{children}</CardContent>
    </Card>
  );
}

async function ProfileView({ params, searchParams }: Pick<PageProps<"/profiles/[id]">, "params" | "searchParams">) {
  const [{ id }, query] = await Promise.all([params, searchParams]);
  await io();
  const profile = await getProfile(id);
  if (!profile) notFound();
  const letters = await db.letter.count({ where: { profileId: id } });
  const p = profile.data;

  return (
    <>
      {query.saved === "1" && <SavedNotice />}
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div className="flex flex-col gap-1">
          <h1 className="font-heading text-4xl">{profile.name}</h1>
          <p className="text-muted-foreground">{p.identity.headline}</p>
          <p className="text-sm text-muted-foreground">{[p.contact.email, p.contact.phone, p.contact.city].filter(Boolean).join(" · ")}</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Link href={`/profiles/${id}/edit`} className={buttonVariants({ variant: "outline", size: "sm" })}>
            Modifier
          </Link>
          <DeleteProfile id={id} name={profile.name} letters={letters} />
        </div>
      </header>

      <div className="flex flex-wrap items-center gap-3 rounded-lg border bg-card px-4 py-3">
        <Button type="button" disabled>
          Générer une lettre avec ce profil
        </Button>
        <span className="text-sm text-muted-foreground">Disponible à la prochaine étape du projet.</span>
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.4fr)]">
        <div className="flex flex-col gap-6">
          <Completeness profile={p} id={id} />
          <Block title="Résumé">
            <p className="max-w-[65ch] text-base">{p.summary}</p>
          </Block>
          <Block title="Disponibilité">
            <p>
              {p.availability.contractTypes.map((t) => CONTRACT_TYPE_LABELS[t]).join(", ")}
              {p.availability.durationMonths ? ` · ${p.availability.durationMonths} mois` : ""}
              {p.availability.startDate ? ` · à partir de ${p.availability.startDate}` : ""}
            </p>
            <p className="text-muted-foreground">
              Mobilité : {[...p.availability.mobility.cities, ...p.availability.mobility.countries].join(", ") || "non précisée"} · Télétravail :{" "}
              {p.availability.acceptsRemote === undefined ? "non précisé" : p.availability.acceptsRemote ? "accepté" : "non souhaité"}
            </p>
          </Block>
          <Skills profile={p} />
        </div>
        <Timeline profile={p} />
      </div>
    </>
  );
}

function Completeness({ profile, id }: { profile: Profile; id: string }) {
  const { score, missing } = profileCompleteness(profile);
  return (
    <Block title="Complétude" description="Plus le profil est complet, plus la lettre peut être précise.">
      <div className="flex items-baseline gap-3">
        <span className="font-heading text-5xl tabular-nums">{score} %</span>
        <span className="text-muted-foreground">{missing.length === 0 ? "Profil complet" : `${missing.length} point${missing.length > 1 ? "s" : ""} à compléter`}</span>
      </div>
      <div className="h-2 overflow-hidden rounded-full bg-muted" role="progressbar" aria-valuenow={score} aria-valuemin={0} aria-valuemax={100} aria-label="Complétude du profil">
        <div className="h-full rounded-full bg-primary" style={{ width: `${score}%` }} />
      </div>
      {missing.length > 0 && (
        <ul className="flex max-h-64 flex-col gap-1 overflow-auto" data-lenis-prevent>
          {missing.map((item) => (
            <li key={`${item.field}-${item.message}`}>
              <Link href={`/profiles/${id}/edit#${item.field}`} className="underline-offset-2 hover:underline">
                {item.message}
              </Link>
            </li>
          ))}
        </ul>
      )}
    </Block>
  );
}

const KIND_LABEL: Record<TimelineEntry["kind"], string> = { experience: "Expérience", education: "Formation", project: "Projet" };

function Timeline({ profile }: { profile: Profile }) {
  const entries = profileTimeline(profile);
  const byId = new Map(profile.experiences.map((e) => [e.id, e]));
  return (
    <Block title="Parcours" description="Du plus récent au plus ancien, à la précision de ton CV.">
      {entries.length === 0 && <p className="text-muted-foreground">Aucun élément daté.</p>}
      <ol className="relative flex flex-col gap-6 border-l pl-6">
        {entries.map((entry) => {
          const experience = byId.get(entry.id);
          return (
            <li key={entry.id} className="relative flex flex-col gap-1">
              <span
                aria-hidden="true"
                className={`absolute top-1.5 -left-[31px] size-3 rounded-full border-2 border-card ${
                  entry.current ? "bg-seal" : entry.kind === "education" ? "bg-muted-foreground" : "bg-primary"
                }`}
              />
              <span className="text-xs font-semibold tracking-wider text-muted-foreground uppercase">
                {periodLabel(entry.start, entry.end) || "Sans date"} · {experience ? EXPERIENCE_TYPE_LABELS[experience.type] : KIND_LABEL[entry.kind]}
                {entry.current ? " · en cours" : ""}
              </span>
              <h3 className="font-medium">
                {entry.title} — {entry.subtitle}
              </h3>
              {experience && experience.achievements.length > 0 && (
                <ul className="list-disc pl-5 text-muted-foreground">
                  {experience.achievements.map((a) => (
                    <li key={a}>{a}</li>
                  ))}
                </ul>
              )}
            </li>
          );
        })}
      </ol>
      {profile.languages.length > 0 && (
        <p className="border-t pt-4">{profile.languages.map((l) => `${l.name} (${LANGUAGE_LEVEL_LABELS[l.level]})`).join(" · ")}</p>
      )}
    </Block>
  );
}

function Skills({ profile }: { profile: Profile }) {
  const usage = skillUsage(profile);
  return (
    <Block title="Compétences" description="Le chiffre indique combien d'expériences ou de projets la mobilisent.">
      {profile.skills.map((group) => (
        <div key={group.category} className="flex flex-col gap-1.5">
          <span className="text-xs font-semibold tracking-wider text-muted-foreground uppercase">{group.category}</span>
          <div className="flex flex-wrap gap-1.5">
            {group.items.map((item) => {
              const count = usage.get(normalizeSkill(item)) ?? 0;
              return (
                <span key={item} className="inline-flex items-center gap-1.5 rounded-sm border bg-background px-2 py-0.5">
                  {item}
                  {count > 0 && <span className="text-xs text-muted-foreground tabular-nums">· {count}</span>}
                </span>
              );
            })}
          </div>
        </div>
      ))}
    </Block>
  );
}
