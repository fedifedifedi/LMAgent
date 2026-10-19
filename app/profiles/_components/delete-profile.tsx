"use client";

import { useState, useTransition } from "react";
import { deleteProfileAction } from "@/app/profiles/actions";
import { Button } from "@/components/ui/button";

/** Suppression avec confirmation dans la page (les dialogues du navigateur ne sont pas utilisés). */
export function DeleteProfile({ id, name, letters }: { id: string; name: string; letters: number }) {
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  if (!confirming) {
    return (
      <Button type="button" variant="outline" size="sm" onClick={() => setConfirming(true)}>
        Supprimer
      </Button>
    );
  }

  return (
    <div role="alert" className="flex flex-wrap items-center gap-2 rounded-md border border-destructive/40 bg-card px-3 py-2 text-sm">
      <span>
        Supprimer le profil de {name}
        {letters > 0 ? ` et ses ${letters} lettre${letters > 1 ? "s" : ""}` : ""} ? C&apos;est définitif.
      </span>
      <Button
        type="button"
        size="sm"
        variant="destructive"
        disabled={pending}
        onClick={() =>
          startTransition(async () => {
            const result = await deleteProfileAction(id);
            if (result) setError(result.error);
          })
        }
      >
        {pending ? "Suppression…" : "Supprimer définitivement"}
      </Button>
      <Button type="button" size="sm" variant="outline" disabled={pending} onClick={() => setConfirming(false)}>
        Annuler
      </Button>
      {error && <span className="text-destructive">{error}</span>}
    </div>
  );
}
