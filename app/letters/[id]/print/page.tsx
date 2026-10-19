import type { Metadata } from "next";
import { io } from "next/cache";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { LetterDocument } from "@/components/letter/letter-document";
import { db } from "@/lib/db";
import { getLetterView } from "@/lib/letters/view";

/** Titre du PDF = objet de la lettre, sans le nom de l'outil (title.absolute ignore le gabarit de l'app). */
export async function generateMetadata({ params }: PageProps<"/letters/[id]/print">): Promise<Metadata> {
  const { id } = await params;
  await io();
  const letter = await db.letter.findUnique({ where: { id }, select: { content: true } });
  const subject = (letter?.content as { subject?: string } | null)?.subject ?? "Lettre de motivation";
  return { title: { absolute: subject }, applicationName: null, description: null, openGraph: null, robots: { index: false } };
}

/**
 * Page d'impression lue par puppeteer : la feuille seule, au format A4 exact, sans sources ni surlignage.
 * L'en-tête de l'application est masqué à l'impression (classe print:hidden dans le layout).
 */
export default function PrintLetterPage({ params }: PageProps<"/letters/[id]/print">) {
  return (
    <Suspense fallback={null}>
      <PrintSheet params={params} />
    </Suspense>
  );
}

async function PrintSheet({ params }: Pick<PageProps<"/letters/[id]/print">, "params">) {
  const { id } = await params;
  await io();
  const view = await getLetterView(id);
  if (!view?.letter) notFound();
  return <LetterDocument letter={view.letter} header={view.header} template={view.template} mode="print" />;
}
