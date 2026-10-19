import type { Metadata } from "next";
import { io } from "next/cache";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { ProfileForm } from "@/app/profiles/_components/profile-form";
import { profileToFormValues } from "@/lib/profile/form-values";
import { getProfile } from "@/lib/repositories/profiles";

export const metadata: Metadata = { title: "Modifier le profil · LMAgent" };

export default function EditProfilePage({ params }: PageProps<"/profiles/[id]/edit">) {
  return (
    <main className="mx-auto flex w-full max-w-4xl flex-col gap-6 px-4 py-10">
      <h1 className="font-heading text-4xl">Modifier le profil</h1>
      <Suspense fallback={<p className="text-muted-foreground">Chargement du profil…</p>}>
        <EditForm params={params} />
      </Suspense>
    </main>
  );
}

async function EditForm({ params }: Pick<PageProps<"/profiles/[id]/edit">, "params">) {
  const { id } = await params;
  await io();
  const profile = await getProfile(id);
  if (!profile) notFound();
  return <ProfileForm defaultValues={profileToFormValues(profile.data)} target={{ profileId: profile.id }} />;
}
