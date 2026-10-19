import type { Metadata } from "next";
import { io } from "next/cache";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense, type ReactNode } from "react";
import { DeleteProfile } from "@/app/profiles/_components/delete-profile";
import { SavedNotice } from "@/app/profiles/_components/saved-notice";
import { Badge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { db } from "@/lib/db";
import { CONTRACT_TYPE_LABELS, educationLabel, experienceLabel, LANGUAGE_LEVEL_LABELS, periodLabel } from "@/lib/profile/labels";
import { profileWarnings } from "@/lib/profile/warnings";
import { profileToFormValues } from "@/lib/profile/form-values";
import { getProfile } from "@/lib/repositories/profiles";

export const metadata: Metadata = { title: "Profil · LMAgent" };

export default function ProfilePage({ params, searchParams }: PageProps<"/profiles/[id]">) {
  return (
    <main className="mx-auto flex w-full max-w-4xl flex-col gap-6 px-4 py-10">
      <Suspense fallback={<p className="text-muted-foreground">Chargement du profil…</p>}>
        <ProfileView params={params} searchParams={searchParams} />
      </Suspense>
    </main>
  );
}

function Block({ title, children }: { title: string; children: ReactNode }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="font-heading text-2xl font-normal">{title}</CardTitle>
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
  const warnings = profileWarnings(profileToFormValues(p));
  const { availability } = p;

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

      {warnings.length > 0 && (
        <p className="text-sm text-muted-foreground">
          {warnings.length} point{warnings.length > 1 ? "s" : ""} à compléter de préférence :{" "}
          <Link href={`/profiles/${id}/edit`} className="underline underline-offset-2">
            compléter le profil
          </Link>
          .
        </p>
      )}

      <Block title="Résumé">
        <p className="max-w-[65ch] text-base">{p.summary}</p>
      </Block>

      <Block title="Disponibilité">
        <p>
          {availability.contractTypes.map((t) => CONTRACT_TYPE_LABELS[t]).join(", ")}
          {availability.durationMonths ? ` · ${availability.durationMonths} mois` : ""}
          {availability.startDate ? ` · à partir de ${availability.startDate}` : ""}
        </p>
        <p className="text-muted-foreground">
          Mobilité : {[...availability.mobility.cities, ...availability.mobility.countries].join(", ") || "non précisée"} · Télétravail :{" "}
          {availability.acceptsRemote === undefined ? "non précisé" : availability.acceptsRemote ? "accepté" : "non souhaité"}
        </p>
      </Block>

      <Block title="Expériences">
        {p.experiences.length === 0 && <p className="text-muted-foreground">Aucune expérience.</p>}
        {p.experiences.map((e) => (
          <article key={e.id} className="flex flex-col gap-1.5">
            <h3 className="font-medium">
              {e.title} — {e.company}
            </h3>
            <p className="text-muted-foreground">{experienceLabel(e)}</p>
            {e.achievements.length > 0 && (
              <ul className="list-disc pl-5">
                {e.achievements.map((a) => (
                  <li key={a}>{a}</li>
                ))}
              </ul>
            )}
            {e.skills.length > 0 && (
              <div className="flex flex-wrap gap-1.5">
                {e.skills.map((s) => (
                  <Badge key={s} variant="secondary">
                    {s}
                  </Badge>
                ))}
              </div>
            )}
          </article>
        ))}
      </Block>

      {p.projects.length > 0 && (
        <Block title="Projets">
          {p.projects.map((project) => (
            <article key={project.id} className="flex flex-col gap-1">
              <h3 className="font-medium">
                {project.name}
                {periodLabel(project.start, project.end) ? ` · ${periodLabel(project.start, project.end)}` : ""}
              </h3>
              <p>{project.summary}</p>
            </article>
          ))}
        </Block>
      )}

      <Block title="Formation">
        {p.education.map((e) => (
          <p key={e.id}>{educationLabel(e)}</p>
        ))}
      </Block>

      <Block title="Compétences et langues">
        {p.skills.map((group) => (
          <div key={group.category} className="flex flex-col gap-1.5">
            <span className="text-xs font-semibold tracking-wider text-muted-foreground uppercase">{group.category}</span>
            <div className="flex flex-wrap gap-1.5">
              {group.items.map((item) => (
                <Badge key={item} variant="secondary">
                  {item}
                </Badge>
              ))}
            </div>
          </div>
        ))}
        {p.languages.length > 0 && <p>{p.languages.map((l) => `${l.name} (${LANGUAGE_LEVEL_LABELS[l.level]})`).join(" · ")}</p>}
      </Block>
    </>
  );
}
