import type { Metadata } from "next";
import { io } from "next/cache";
import Link from "next/link";
import { Suspense } from "react";
import { NewLetterForm } from "@/app/letters/_components/new-letter-form";
import { buttonVariants } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { listProfileCards } from "@/lib/repositories/profiles";

export const metadata: Metadata = { title: "Nouvelle lettre · LMAgent" };

export default function NewLetterPage({ searchParams }: PageProps<"/letters/new">) {
  return (
    <main className="mx-auto flex w-full max-w-3xl flex-col gap-6 px-4 py-10">
      <Card>
        <CardHeader>
          <CardTitle className="font-heading text-3xl font-normal">Nouvelle lettre</CardTitle>
          <CardDescription>Colle l&apos;offre : l&apos;agent l&apos;analyse, la compare à ton profil, rédige la lettre puis la relit.</CardDescription>
        </CardHeader>
        <CardContent>
          <Suspense fallback={<p className="text-muted-foreground">Chargement des profils…</p>}>
            <Form searchParams={searchParams} />
          </Suspense>
        </CardContent>
      </Card>
    </main>
  );
}

async function Form({ searchParams }: Pick<PageProps<"/letters/new">, "searchParams">) {
  const query = await searchParams;
  await io();
  const profiles = await listProfileCards();
  if (profiles.length === 0) {
    return (
      <div className="flex flex-col items-start gap-3">
        <p className="text-muted-foreground">Il faut d&apos;abord un profil enregistré : importe ton CV.</p>
        <Link href="/profiles/new" className={buttonVariants()}>
          Importer un CV
        </Link>
      </div>
    );
  }
  const requested = typeof query.profile === "string" ? query.profile : undefined;
  return (
    <NewLetterForm
      profiles={profiles.map((p) => ({ id: p.id, name: p.name, headline: p.headline }))}
      defaultProfileId={profiles.some((p) => p.id === requested) ? requested : undefined}
    />
  );
}
