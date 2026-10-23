import type { Metadata } from "next";
import { io } from "next/cache";
import { Suspense } from "react";
import { AccessForm } from "@/app/acces/access-form";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { isComintyMode, requestHasAccess } from "@/lib/cominty/agent-client";
import { accessRequired, budgetUsd, spentUsd } from "@/lib/cominty/guard";

export const metadata: Metadata = { title: { absolute: "Code d'accès · LMAgent" } };

export default function AccessPage() {
  return (
    <main className="mx-auto flex w-full max-w-2xl flex-col gap-6 px-4 py-10">
      <Card>
        <CardHeader>
          <CardTitle className="font-heading text-3xl font-normal">Code d&apos;accès</CardTitle>
          <CardDescription>
            Chaque vrai appel à l&apos;agent Cominty est payant. Sans code, tu peux essayer la démo enregistrée depuis l&apos;accueil :
            elle rejoue un vrai run, sans aucun appel.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Suspense fallback={<p className="text-sm text-muted-foreground">Chargement…</p>}>
            <AccessStatus />
          </Suspense>
        </CardContent>
      </Card>
    </main>
  );
}

async function AccessStatus() {
  await io();
  if (!isComintyMode()) return <p className="text-sm">Mode démonstration hors ligne (mock) : aucun appel réel, aucun code nécessaire.</p>;
  const [granted, spent] = [await requestHasAccess(), await spentUsd()];
  const budget = budgetUsd();
  const usd = (value: number) => value.toLocaleString("fr-FR", { style: "currency", currency: "USD" });
  return (
    <div className="flex flex-col gap-4">
      {!accessRequired() && <p className="text-sm text-muted-foreground">Aucun code n&apos;est exigé sur cette installation (développement local).</p>}
      <AccessForm granted={granted} />
      <p className="text-xs text-muted-foreground tabular-nums">
        Dépense Cominty : {usd(spent)} sur un plafond de {usd(budget)}
        {spent >= budget ? " — plafond atteint, plus aucun appel n'est lancé." : "."}
      </p>
    </div>
  );
}
