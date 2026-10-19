"use client";

import { useState, useTransition } from "react";
import { deleteLetterAction } from "@/app/letters/actions";
import { Button } from "@/components/ui/button";

/** Suppression d'une lettre avec confirmation dans la page. */
export function DeleteLetter({ id, title, disabled }: { id: string; title: string; disabled?: boolean }) {
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  if (!confirming) {
    return (
      <Button type="button" variant="outline" size="sm" disabled={disabled} onClick={() => setConfirming(true)}>
        Supprimer la lettre
      </Button>
    );
  }

  return (
    <div role="alert" className="flex flex-wrap items-center gap-2 rounded-md border border-destructive/40 bg-card px-3 py-2 text-sm">
      <span>Supprimer la lettre « {title} » ? C&apos;est définitif.</span>
      <Button
        type="button"
        size="sm"
        variant="destructive"
        disabled={pending}
        onClick={() =>
          startTransition(async () => {
            const result = await deleteLetterAction(id);
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
