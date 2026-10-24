"use client";

import { useFormStatus } from "react-dom";
import { startDemoAction } from "@/app/demo/actions";
import { buttonVariants } from "@/components/ui/button";

function Submit() {
  const { pending } = useFormStatus();
  return (
    <button type="submit" disabled={pending} className={buttonVariants({ size: "lg", variant: "outline" })}>
      {pending ? "Préparation de la démo…" : "Essayer avec un profil de démo"}
    </button>
  );
}

/** Lettre générée pour un profil fictif (Léa Dubois), sans importer de CV. */
export function DemoButton() {
  return (
    <form action={startDemoAction}>
      <Submit />
    </form>
  );
}
