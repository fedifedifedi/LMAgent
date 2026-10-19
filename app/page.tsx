import { io } from "next/cache";
import Link from "next/link";
import { Suspense } from "react";
import { LogoStacked } from "@/components/logo";
import { buttonVariants } from "@/components/ui/button";
import { db } from "@/lib/db";

const STEPS = [
  { title: "Importe ton CV", text: "PDF, photo ou texte collé. Tu vérifies ce que l'agent a lu, tu complètes ce qui manque." },
  { title: "Colle une offre", text: "Le texte de l'annonce ou son lien. L'agent en tire le poste, l'entreprise et les compétences demandées." },
  { title: "Obtiens ta lettre", text: "Une page, dans la langue de l'offre, qui ne cite que ce que tu as vraiment fait. Chaque phrase garde sa source." },
];

export default function Home() {
  return (
    <main className="mx-auto flex w-full max-w-4xl flex-1 flex-col gap-12 px-4 py-14 sm:py-20">
      <section className="flex flex-col gap-6">
        <LogoStacked className="self-start" />
        <h1 className="max-w-[15ch] font-heading text-5xl leading-[1.02] sm:text-6xl">
          Une lettre par offre, écrite à partir de <em>ton parcours</em>.
        </h1>
        <p className="max-w-[52ch] text-lg text-muted-foreground">
          Importe ton CV, colle une offre : LMAgent rédige une lettre de motivation d&apos;une page, adaptée à l&apos;entreprise, sans
          rien inventer.
        </p>
        <div className="flex flex-wrap gap-3">
          <Suspense fallback={<StartLink href="/profiles/new" />}>
            <Start />
          </Suspense>
        </div>
      </section>

      <ol className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        {STEPS.map((step, index) => (
          <li key={step.title} className="flex flex-col gap-2 rounded-lg border bg-card p-5">
            <span className="font-heading text-3xl text-muted-foreground">{index + 1}</span>
            <h2 className="text-base font-semibold">{step.title}</h2>
            <p className="text-sm text-muted-foreground">{step.text}</p>
          </li>
        ))}
      </ol>
    </main>
  );
}

function StartLink({ href }: { href: string }) {
  return (
    <Link href={href} className={buttonVariants({ size: "lg" })}>
      Commencer
    </Link>
  );
}

/** Déjà un profil : on reprend depuis la liste plutôt que de réimporter un CV. */
async function Start() {
  await io();
  const hasProfile = (await db.profile.count()) > 0;
  return (
    <>
      <StartLink href={hasProfile ? "/profiles" : "/profiles/new"} />
      {hasProfile && (
        <Link href="/profiles/new" className={buttonVariants({ size: "lg", variant: "outline" })}>
          Importer un autre CV
        </Link>
      )}
    </>
  );
}
