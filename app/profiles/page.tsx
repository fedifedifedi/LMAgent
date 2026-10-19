import type { Metadata } from "next";
import { io } from "next/cache";
import Link from "next/link";
import { Suspense } from "react";
import { Reveal } from "@/components/motion/reveal";
import { buttonVariants } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { listProfileCards } from "@/lib/repositories/profiles";

export const metadata: Metadata = { title: "Profils · LMAgent" };

export default function ProfilesPage() {
  return (
    <main className="mx-auto flex w-full max-w-4xl flex-col gap-6 px-4 py-10">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div className="flex flex-col gap-1">
          <h1 className="font-heading text-4xl">Profils</h1>
          <p className="text-muted-foreground">Chaque profil sert de base à des lettres : la lettre ne cite que ce qu&apos;il contient.</p>
        </div>
        <Link href="/profiles/new" className={buttonVariants()}>
          Importer un CV
        </Link>
      </header>
      <Suspense fallback={<p className="text-muted-foreground">Chargement des profils…</p>}>
        <ProfileList />
      </Suspense>
    </main>
  );
}

const plural = (n: number, one: string, many: string) => `${n} ${n > 1 ? many : one}`;

async function ProfileList() {
  // libSQL local répond pendant le prerender : sans io(), la liste serait figée au build.
  await io();
  const profiles = await listProfileCards();
  if (profiles.length === 0) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="font-heading text-2xl font-normal">Aucun profil pour l&apos;instant</CardTitle>
          <CardDescription>Importe ton CV (PDF, image ou texte) : tu vérifieras le profil avant de l&apos;enregistrer.</CardDescription>
        </CardHeader>
      </Card>
    );
  }
  return (
    <Reveal className="grid grid-cols-1 gap-4 sm:grid-cols-2">
      {profiles.map((profile) => (
        <Link key={profile.id} href={`/profiles/${profile.id}`} className="group rounded-lg focus-visible:outline-2 focus-visible:outline-ring">
          <Card className="h-full transition-colors group-hover:border-foreground/30">
            <CardHeader>
              <CardTitle className="font-heading text-2xl font-normal">{profile.name}</CardTitle>
              <CardDescription>{profile.headline}</CardDescription>
            </CardHeader>
            <CardContent className="flex flex-col gap-1 text-sm text-muted-foreground">
              <span>
                {plural(profile.counts.experiences, "expérience", "expériences")} · {plural(profile.counts.projects, "projet", "projets")} ·{" "}
                {plural(profile.counts.skills, "compétence", "compétences")}
              </span>
              <span>
                {plural(profile.counts.letters, "lettre", "lettres")} · modifié le{" "}
                {profile.updatedAt.toLocaleDateString("fr-FR", { day: "numeric", month: "long", year: "numeric" })}
              </span>
            </CardContent>
          </Card>
        </Link>
      ))}
    </Reveal>
  );
}
