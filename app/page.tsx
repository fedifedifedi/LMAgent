import { io } from "next/cache";
import Link from "next/link";
import { Suspense } from "react";
import { DemoButton } from "@/app/_components/demo-button";
import { HomeMotion } from "@/app/_components/home-motion";
import { demoEnabled } from "@/lib/demo";
import { LogoStacked } from "@/components/logo";
import { SpotlightCard } from "@/components/spotlight-card";
import { buttonVariants } from "@/components/ui/button";
import { db } from "@/lib/db";
import { cn } from "@/lib/utils";

const STEPS = [
  { title: "Importe ton CV", text: "PDF, photo ou texte collé. Tu vérifies ce que l'agent a lu, tu complètes ce qui manque." },
  { title: "Colle une offre", text: "Le texte de l'annonce ou son lien. Poste, entreprise et compétences demandées s'affichent." },
  { title: "Obtiens ta lettre", text: "Relue par l'agent, retouchable, exportée en PDF d'une page. Chaque phrase garde sa source." },
];

const PROOFS = ["Chaque phrase garde sa source", "Une page A4, en français ou en anglais", "PDF sans aucune marque"];

export default function Home() {
  return (
    <main className="mx-auto flex w-full max-w-6xl flex-1 flex-col px-4 py-12 sm:py-16">
      <HomeMotion>
        <div className="flex flex-col gap-14">
          <section className="grid grid-cols-1 items-center gap-10 lg:grid-cols-[minmax(0,1.05fr)_minmax(0,0.95fr)]">
            <div className="flex flex-col gap-6">
              <LogoStacked className="self-start" />
              <h1 className="home-title max-w-[14ch] font-heading text-5xl leading-[1.02] sm:text-6xl">
                Une lettre par offre, écrite à partir de <span className="whitespace-nowrap"><em>ton parcours</em>.</span>
              </h1>
              <span aria-hidden="true" className="home-rule h-px w-32 origin-left bg-foreground" />
              <p className="home-lede max-w-[48ch] text-lg text-muted-foreground">
                Importe ton CV, colle une offre : LMAgent rédige une lettre de motivation d&apos;une page, adaptée à l&apos;entreprise, sans
                rien inventer.
              </p>
              <div className="home-actions flex flex-wrap gap-3">
                <Suspense fallback={<StartLink href="/profiles/new" />}>
                  <Start />
                </Suspense>
                {demoEnabled() && <DemoButton />}
              </div>
              <ul className="home-lede flex flex-wrap gap-x-5 gap-y-1 text-sm text-muted-foreground">
                {PROOFS.map((proof) => (
                  <li key={proof}>
                    <span className="font-bold text-[#1f7a4d] dark:text-[#5fcf95]">✓</span> {proof}
                  </li>
                ))}
              </ul>
            </div>
            <LetterStack />
          </section>

          <ol className="home-steps grid grid-cols-1 gap-4 sm:grid-cols-3">
            {STEPS.map((step, index) => (
              <li key={step.title} className="home-step">
                <SpotlightCard className="flex h-full flex-col gap-2 rounded-xl border p-5">
                  <span className="font-heading text-4xl text-muted-foreground">{index + 1}</span>
                  <h2 className="text-base font-semibold">{step.title}</h2>
                  <p className="text-sm text-muted-foreground">{step.text}</p>
                </SpotlightCard>
              </li>
            ))}
          </ol>
        </div>
      </HomeMotion>
    </main>
  );
}

/** Pile de lettres d'exemple (illustration, contenu non lisible) : montre ce que l'outil produit. */
function LetterStack() {
  const lines = (count: number, highlight: number[] = []) =>
    Array.from({ length: count }, (_, i) => (
      <span
        key={i}
        className={cn("block h-[5px] rounded-sm", highlight.includes(i) ? "bg-[linear-gradient(90deg,#e3e7ef_0_30%,#ffd9b5_30%_55%,#e3e7ef_55%)]" : "bg-[#e3e7ef]")}
        style={{ width: `${[100, 92, 97, 84, 95, 70][i % 6]}%` }}
      />
    ));
  const sheet = "absolute aspect-[210/297] w-[72%] rounded-[3px] bg-white p-[7%] text-[#1c2a4a] shadow-[0_2px_4px_rgb(16_22_42/0.08),0_18px_40px_rgb(16_22_42/0.16)]";
  return (
    <div aria-hidden="true" className="relative mx-auto hidden h-[25rem] w-full max-w-md sm:block">
      <div className={cn(sheet, "top-0 right-0 rotate-[4deg] opacity-50")}>
        <span className="block font-heading text-xl leading-none">Léa Dubois</span>
        <span className="mt-4 flex flex-col gap-2">{lines(10)}</span>
      </div>
      <div className={cn(sheet, "top-4 right-[9%] -rotate-2")}>
        <span className="block font-heading text-2xl leading-none">Ton nom</span>
        <span className="mt-1.5 block font-sans text-[7px] font-semibold tracking-[0.06em] text-[#5f6880] uppercase">Ville · e-mail · téléphone</span>
        <span className="mt-2 block h-[1.5px] w-10 bg-[#1c2a4a]" />
        <span className="mt-4 flex flex-col gap-2">{lines(14, [2, 7])}</span>
        <span className="absolute bottom-[24%] -left-6 rotate-2 rounded-lg border border-[#d9dde6] bg-white px-3 py-2 font-sans text-xs font-semibold shadow-lg">
          ✓ 4 sources citées
        </span>
      </div>
    </div>
  );
}

function StartLink({ href }: { href: string }) {
  return (
    <Link href={href} className={cn(buttonVariants({ size: "lg" }), "btn-shine")}>
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
