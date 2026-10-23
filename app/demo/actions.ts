"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { isComintyMode, requestHasAccess } from "@/lib/cominty/agent-client";
import { demoEnabled } from "@/lib/demo";
import { ensureDemoLetter } from "@/lib/demo/start";

/**
 * « Essayer avec un profil de démo » : ouvre une lettre du profil fictif.
 * Mode Cominty sans code d'accès : nouvelle lettre qui rejoue un vrai run enregistré (aucun appel, gratuit).
 * Avec le code (vrai run) ou en mode mock : la dernière lettre de démo est réutilisée (pas de nouvel appel).
 */
export async function startDemoAction(): Promise<void> {
  if (!demoEnabled()) redirect("/");
  const replay = isComintyMode() && !(await requestHasAccess());
  const letterId = await ensureDemoLetter({ fresh: replay });
  revalidatePath("/profiles");
  redirect(`/letters/${letterId}`);
}
