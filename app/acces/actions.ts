"use server";

import { cookies } from "next/headers";
import { ACCESS_COOKIE, accessRequired, hashAccessCode } from "@/lib/cominty/guard";

export type AccessState = { ok?: boolean; error?: string };

const THIRTY_DAYS = 60 * 60 * 24 * 30;

/** Vérifie le code d'accès ; s'il est bon, pose un cookie httpOnly avec son empreinte (jamais le code lui-même). */
export async function submitAccessCodeAction(_previous: AccessState, formData: FormData): Promise<AccessState> {
  const code = String(formData.get("code") ?? "").trim();
  const expected = process.env.DEMO_ACCESS_CODE?.trim();
  if (!accessRequired()) return { ok: true };
  if (!expected) return { error: "Aucun code d'accès n'est configuré sur cette installation : seule la démo enregistrée est disponible." };
  if (!code || hashAccessCode(code) !== hashAccessCode(expected)) return { error: "Code d'accès incorrect." };
  const store = await cookies();
  store.set(ACCESS_COOKIE, hashAccessCode(code), { httpOnly: true, sameSite: "lax", secure: process.env.NODE_ENV === "production", path: "/", maxAge: THIRTY_DAYS });
  return { ok: true };
}

export async function forgetAccessCodeAction(): Promise<void> {
  const store = await cookies();
  store.delete(ACCESS_COOKIE);
}
