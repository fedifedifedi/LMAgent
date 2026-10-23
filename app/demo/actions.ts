"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { demoEnabled } from "@/lib/demo";
import { ensureDemoLetter } from "@/lib/demo/start";

/** « Essayer avec un profil de démo » : ouvre la lettre du profil fictif (créée au premier clic). */
export async function startDemoAction(): Promise<void> {
  if (!demoEnabled()) redirect("/");
  const letterId = await ensureDemoLetter();
  revalidatePath("/profiles");
  redirect(`/letters/${letterId}`);
}
