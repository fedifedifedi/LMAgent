import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { draftWarnings } from "@/lib/cv/draft-warnings";
import { getCvImport } from "@/lib/repositories/cv-imports";

export const metadata: Metadata = { title: "Brouillon de profil · LMAgent" };

export default function CvImportPage({ params }: PageProps<"/profiles/import/[id]">) {
  return (
    <main className="mx-auto flex w-full max-w-3xl flex-col gap-6 px-4 py-10">
      <Suspense fallback={<p className="text-muted-foreground">Chargement du brouillon…</p>}>
        <CvImportView params={params} />
      </Suspense>
    </main>
  );
}

async function CvImportView({ params }: Pick<PageProps<"/profiles/import/[id]">, "params">) {
  const { id } = await params;
  const cvImport = await getCvImport(id);
  if (!cvImport) notFound();

  const { draft, usage } = cvImport;
  const warnings = draftWarnings(draft);
  const fullName = [draft.identity.firstName, draft.identity.lastName].filter(Boolean).join(" ") || "Nom non trouvé";
  const counts = [
    ["Expériences", draft.experiences.length],
    ["Projets", draft.projects.length],
    ["Formations", draft.education.length],
    ["Compétences", draft.skills.reduce((total, group) => total + group.items.length, 0)],
    ["Langues", draft.languages.length],
  ] as const;

  return (
    <>
      <Card>
        <CardHeader>
          <CardTitle>{fullName}</CardTitle>
          <CardDescription>{draft.identity.headline ?? "Titre non trouvé"}</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          <div className="flex flex-wrap gap-2">
            {counts.map(([label, count]) => (
              <Badge key={label} variant="secondary">
                {label} : {count}
              </Badge>
            ))}
          </div>
          <p className="text-sm text-muted-foreground">
            Source : {cvImport.source === "PDF" ? `PDF « ${cvImport.sourceName} »` : "texte collé"} · {usage.provider} /{" "}
            {usage.model} · {usage.inputTokens + usage.outputTokens} tokens{usage.estimated ? " (estimés)" : ""} ·{" "}
            {usage.attempts} tentative{usage.attempts > 1 ? "s" : ""}
          </p>
        </CardContent>
      </Card>

      {cvImport.degraded && (
        <Alert variant="destructive">
          <AlertTitle>Extraction partielle</AlertTitle>
          <AlertDescription>
            <p>Le modèle n&apos;a pas respecté tout le format attendu. Les champs concernés ont été vidés ; vérifie-les.</p>
            <pre className="mt-2 whitespace-pre-wrap text-xs">{cvImport.issues}</pre>
          </AlertDescription>
        </Alert>
      )}

      {warnings.incompleteDates.length > 0 && (
        <Alert>
          <AlertTitle>Dates à préciser</AlertTitle>
          <AlertDescription>
            <p>Le CV ne donne que l&apos;année : précise le mois si tu le connais, sinon garde l&apos;année.</p>
            <ul className="mt-2 list-disc pl-5">
              {warnings.incompleteDates.map((label) => (
                <li key={label}>{label}</li>
              ))}
            </ul>
          </AlertDescription>
        </Alert>
      )}

      {(warnings.missingSummary || warnings.missingAvailability) && (
        <Alert>
          <AlertTitle>À compléter</AlertTitle>
          <AlertDescription>
            <ul className="list-disc pl-5">
              {warnings.missingSummary && <li>Ton CV n&apos;a pas de résumé : tu l&apos;écriras dans le formulaire.</li>}
              {warnings.missingAvailability && <li>Aucune disponibilité trouvée (type de contrat, date de début…).</li>}
            </ul>
          </AlertDescription>
        </Alert>
      )}

      <Card>
        <CardHeader>
          <CardTitle>Brouillon extrait</CardTitle>
          <CardDescription>Le formulaire de vérification et d&apos;enregistrement arrive à l&apos;étape suivante.</CardDescription>
        </CardHeader>
        <CardContent>
          <pre className="max-h-[32rem] overflow-auto rounded-md bg-muted p-4 text-xs">{JSON.stringify(draft, null, 2)}</pre>
        </CardContent>
      </Card>
    </>
  );
}
