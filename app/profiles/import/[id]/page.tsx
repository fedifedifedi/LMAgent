import type { Metadata } from "next";
import { io } from "next/cache";
import { notFound, redirect } from "next/navigation";
import { Suspense } from "react";
import { ProfileForm } from "@/app/profiles/_components/profile-form";
import { Stepper } from "@/components/stepper";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { profileWarnings } from "@/lib/profile/warnings";
import { draftToFormValues } from "@/lib/profile/form-values";
import { getCvImport } from "@/lib/repositories/cv-imports";

export const metadata: Metadata = { title: "Vérifier le profil · LMAgent" };

export default function CvImportPage({ params }: PageProps<"/profiles/import/[id]">) {
  return (
    <main className="mx-auto flex w-full max-w-4xl flex-col gap-6 px-4 py-10">
      <Stepper steps={["Importer", "Vérifier", "Enregistrer"]} current={1} />
      <header className="flex flex-col gap-2">
        <h1 className="font-heading text-4xl">Vérifie ton profil</h1>
        <p className="max-w-[65ch] text-muted-foreground">
          Voici ce que le modèle a lu dans ton CV. Corrige ce qui est faux, complète ce qui manque : la lettre ne citera que ce
          qui est enregistré ici.
        </p>
      </header>
      <Suspense fallback={<p className="text-muted-foreground">Chargement du brouillon…</p>}>
        <CvImportForm params={params} />
      </Suspense>
    </main>
  );
}

async function CvImportForm({ params }: Pick<PageProps<"/profiles/import/[id]">, "params">) {
  const { id } = await params;
  await io();
  const cvImport = await getCvImport(id);
  if (!cvImport) notFound();
  // Déjà enregistré : on modifie le profil existant plutôt que d'en créer un second.
  if (cvImport.profileId) redirect(`/profiles/${cvImport.profileId}/edit`);

  const defaultValues = draftToFormValues(cvImport.draft);
  const { usage } = cvImport;
  const source = { PDF: `PDF « ${cvImport.sourceName} »`, IMAGE: `image « ${cvImport.sourceName} »`, TEXT: "texte collé" }[cvImport.source];

  return (
    <>
      <p className="text-sm text-muted-foreground">
        Source : {source}
        {cvImport.readMode === "NATIVE" ? ", lue directement par le modèle" : ""} · {profileWarnings(defaultValues).length} point(s) à
        compléter · {usage.provider} / {usage.model}, {usage.inputTokens + usage.outputTokens} tokens{usage.estimated ? " (estimés)" : ""}
      </p>
      {cvImport.readMode === "NATIVE" && (
        <Alert>
          <AlertTitle>CV lu à partir de l&apos;image</AlertTitle>
          <AlertDescription>Les passages illisibles ont été laissés vides plutôt que devinés : compare avec ton CV.</AlertDescription>
        </Alert>
      )}
      {cvImport.degraded && (
        <Alert variant="destructive">
          <AlertTitle>Extraction partielle</AlertTitle>
          <AlertDescription>Le modèle n&apos;a pas respecté tout le format attendu : certains champs ont été vidés, vérifie-les.</AlertDescription>
        </Alert>
      )}
      <ProfileForm defaultValues={defaultValues} target={{ importId: cvImport.id }} />
    </>
  );
}
