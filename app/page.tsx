import Link from "next/link";
import { buttonVariants } from "@/components/ui/button";

export default function Home() {
  return (
    <main className="mx-auto flex w-full max-w-3xl flex-1 flex-col justify-center gap-6 px-4 py-16">
      <h1 className="text-3xl font-semibold tracking-tight">LMAgent</h1>
      <p className="text-lg text-muted-foreground">
        Des lettres de motivation personnalisées pour chaque offre, à partir de ton profil et de tes documents.
      </p>
      <div className="flex flex-wrap gap-3">
        <Link href="/profiles/new" className={buttonVariants()}>
          Créer un profil à partir d&apos;un CV
        </Link>
        <Link href="/profiles" className={buttonVariants({ variant: "outline" })}>
          Mes profils
        </Link>
      </div>
    </main>
  );
}
