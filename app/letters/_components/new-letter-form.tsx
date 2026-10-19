"use client";

import { useActionState, useState } from "react";
import { createLetterAction, type NewLetterState } from "@/app/letters/actions";
import { selectClassName } from "@/app/profiles/_components/fields";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";

type Mode = "text" | "url";

export function NewLetterForm({ profiles, defaultProfileId }: { profiles: Array<{ id: string; name: string; headline: string }>; defaultProfileId?: string }) {
  const [state, formAction, pending] = useActionState<NewLetterState, FormData>(createLetterAction, {});
  const [mode, setMode] = useState<Mode>("text");
  const [handled, setHandled] = useState<NewLetterState | null>(null);

  // Lien illisible (LinkedIn, Indeed...) : on bascule sur le collage du texte, une fois par réponse du serveur.
  if (state !== handled) {
    setHandled(state);
    if (state.switchToPaste) setMode("text");
  }

  return (
    <form action={formAction} className="flex flex-col gap-6">
      <input type="hidden" name="mode" value={mode} />

      <div className="flex flex-col gap-1.5">
        <Label htmlFor="profileId">Profil</Label>
        <select id="profileId" name="profileId" defaultValue={defaultProfileId ?? profiles[0]?.id} className={selectClassName} disabled={pending}>
          {profiles.map((profile) => (
            <option key={profile.id} value={profile.id}>
              {profile.name} — {profile.headline}
            </option>
          ))}
        </select>
      </div>

      <Tabs value={mode} onValueChange={(value) => setMode(value as Mode)}>
        <TabsList>
          <TabsTrigger value="text">Coller le texte</TabsTrigger>
          <TabsTrigger value="url">Lien de l&apos;offre</TabsTrigger>
        </TabsList>
        <TabsContent value="text" className="flex flex-col gap-2 pt-4">
          <Label htmlFor="offer-text">Texte de l&apos;offre</Label>
          <Textarea
            id="offer-text"
            name="text"
            rows={14}
            defaultValue={state.text}
            key={`text-${state.text ?? ""}`}
            placeholder="Colle ici l'annonce complète : poste, missions, profil recherché, entreprise…"
            disabled={pending}
            data-lenis-prevent
          />
        </TabsContent>
        <TabsContent value="url" className="flex flex-col gap-2 pt-4">
          <Label htmlFor="offer-url">Lien de l&apos;offre</Label>
          <Input id="offer-url" name="url" type="url" inputMode="url" defaultValue={state.url} key={`url-${state.url ?? ""}`} placeholder="https://…" disabled={pending} />
          <p className="text-sm text-muted-foreground">LinkedIn, Indeed et d&apos;autres sites bloquent souvent la lecture automatique : dans ce cas, colle le texte.</p>
        </TabsContent>
      </Tabs>

      {state.error && (
        <Alert variant="destructive" aria-live="polite">
          <AlertTitle>{state.switchToPaste ? "Lien illisible" : "Impossible de créer la lettre"}</AlertTitle>
          <AlertDescription>{state.error}</AlertDescription>
        </Alert>
      )}

      <div className="flex items-center gap-3">
        <Button type="submit" disabled={pending || profiles.length === 0}>
          {pending ? (mode === "url" ? "Lecture de la page…" : "Création…") : "Générer la lettre"}
        </Button>
      </div>
    </form>
  );
}
