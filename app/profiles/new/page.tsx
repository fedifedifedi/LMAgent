import type { Metadata } from "next";
import { CvImportForm } from "@/app/profiles/new/cv-import-form";
import { Stepper } from "@/components/stepper";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

export const metadata: Metadata = { title: "Nouveau profil · LMAgent" };

const IMPORT_STEPS = ["Importer", "Vérifier", "Enregistrer"];

export default function NewProfilePage() {
  return (
    <main className="mx-auto flex w-full max-w-3xl flex-col gap-6 px-4 py-10">
      <Stepper steps={IMPORT_STEPS} current={0} />
      <Card>
        <CardHeader>
          <CardTitle className="font-heading text-3xl font-normal">Importer un CV</CardTitle>
          <CardDescription>
            Le CV est analysé pour pré-remplir ton profil. Tu pourras tout vérifier et corriger avant de l&apos;enregistrer.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <CvImportForm />
        </CardContent>
      </Card>
    </main>
  );
}
