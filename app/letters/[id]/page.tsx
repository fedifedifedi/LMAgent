import type { Metadata } from "next";
import { io } from "next/cache";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { LetterWorkspace } from "@/app/letters/_components/letter-workspace";
import { getLetterView } from "@/lib/letters/view";

export const metadata: Metadata = { title: "Lettre · LMAgent" };

export default function LetterPage({ params }: PageProps<"/letters/[id]">) {
  return (
    <main className="mx-auto flex w-full max-w-6xl flex-col gap-6 px-4 py-10">
      <Suspense fallback={<p className="text-muted-foreground">Chargement de la lettre…</p>}>
        <Letter params={params} />
      </Suspense>
    </main>
  );
}

async function Letter({ params }: Pick<PageProps<"/letters/[id]">, "params">) {
  const { id } = await params;
  await io();
  const view = await getLetterView(id);
  if (!view) notFound();
  return (
    <>
      <Link href={`/profiles/${view.profileId}`} className="text-sm text-muted-foreground underline-offset-2 hover:underline">
        ← {view.profileName}
      </Link>
      <LetterWorkspace initial={view} />
    </>
  );
}
