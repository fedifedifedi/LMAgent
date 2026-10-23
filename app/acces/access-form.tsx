"use client";

import Link from "next/link";
import { useActionState } from "react";
import { forgetAccessCodeAction, submitAccessCodeAction, type AccessState } from "@/app/acces/actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

export function AccessForm({ granted }: { granted: boolean }) {
  const [state, action, pending] = useActionState<AccessState, FormData>(submitAccessCodeAction, {});
  if (granted || state.ok) {
    return (
      <div className="flex flex-col gap-3">
        <p className="text-sm">Accès actif : les vrais appels à l&apos;agent Cominty sont autorisés depuis ce navigateur, dans la limite du plafond.</p>
        <div className="flex flex-wrap gap-3">
          <Link href="/profiles/new" className="underline underline-offset-2">
            Importer un CV
          </Link>
          <form action={forgetAccessCodeAction}>
            <button type="submit" className="text-sm text-muted-foreground underline underline-offset-2">
              Oublier le code sur ce navigateur
            </button>
          </form>
        </div>
      </div>
    );
  }
  return (
    <form action={action} className="flex flex-col gap-3">
      <label htmlFor="code" className="text-sm font-medium">
        Code d&apos;accès
      </label>
      <Input id="code" name="code" type="password" autoComplete="off" required className="max-w-xs" />
      {state.error && (
        <p className="text-sm text-destructive" role="alert">
          {state.error}
        </p>
      )}
      <div>
        <Button type="submit" disabled={pending}>
          {pending ? "Vérification…" : "Valider"}
        </Button>
      </div>
    </form>
  );
}
