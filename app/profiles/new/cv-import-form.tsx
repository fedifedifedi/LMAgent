"use client";

import { useActionState, useState } from "react";
import { importCvAction, type ImportCvState } from "@/app/profiles/new/actions";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";

type Mode = "pdf" | "text";

export function CvImportForm() {
  const [state, formAction, pending] = useActionState<ImportCvState, FormData>(importCvAction, {});
  const [mode, setMode] = useState<Mode>("pdf");

  return (
    <form action={formAction} className="flex flex-col gap-6">
      <input type="hidden" name="mode" value={mode} />

      <Tabs value={mode} onValueChange={(value) => setMode(value as Mode)}>
        <TabsList>
          <TabsTrigger value="pdf">Téléverser un PDF</TabsTrigger>
          <TabsTrigger value="text">Coller le texte</TabsTrigger>
        </TabsList>

        <TabsContent value="pdf" className="flex flex-col gap-2 pt-4">
          <Label htmlFor="cv-file">CV au format PDF (5 Mo max)</Label>
          <Input id="cv-file" name="file" type="file" accept="application/pdf,.pdf" disabled={pending} />
          <p className="text-sm text-muted-foreground">
            Un PDF scanné (image) ne contient pas de texte : utilise plutôt l&apos;onglet « Coller le texte ».
          </p>
        </TabsContent>

        <TabsContent value="text" className="flex flex-col gap-2 pt-4">
          <Label htmlFor="cv-text">Texte du CV</Label>
          <Textarea
            id="cv-text"
            name="text"
            rows={16}
            defaultValue={state.text}
            key={state.text ?? "empty"}
            placeholder="Colle ici le contenu de ton CV…"
            disabled={pending}
          />
        </TabsContent>
      </Tabs>

      {state.error && (
        <Alert variant="destructive" aria-live="polite">
          <AlertTitle>Import impossible</AlertTitle>
          <AlertDescription>{state.error}</AlertDescription>
        </Alert>
      )}

      <div className="flex items-center gap-3">
        <Button type="submit" disabled={pending}>
          {pending ? "Analyse en cours…" : "Analyser le CV"}
        </Button>
        {pending && <p className="text-sm text-muted-foreground">Extraction du profil par le modèle, quelques secondes…</p>}
      </div>
    </form>
  );
}
