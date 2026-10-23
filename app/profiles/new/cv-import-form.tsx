"use client";

import { useActionState, useEffect, useRef, useState, type ChangeEvent, type DragEvent } from "react";
import { importCvAction, type ImportCvState } from "@/app/profiles/new/actions";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { isHeicFile, isImageFile, resizeImage } from "@/lib/cv/resize-image";

type Mode = "file" | "text";

type Selected =
  | { kind: "pdf"; name: string; size: number }
  | { kind: "image"; name: string; blob: Blob; previewUrl: string; width: number; height: number };

const kilobytes = (bytes: number) => `${Math.round(bytes / 1024).toLocaleString("fr-FR")} Ko`;

export function CvImportForm() {
  const [mode, setMode] = useState<Mode>("file");
  const [selected, setSelected] = useState<Selected | null>(null);
  const [fileError, setFileError] = useState<string | null>(null);
  const [preparing, setPreparing] = useState(false);

  // L'image envoyée est la version redimensionnée, pas le fichier d'origine.
  const [state, formAction, pending] = useActionState<ImportCvState, FormData>(async (previous, formData) => {
    if (formData.get("mode") === "file" && selected?.kind === "image") {
      const name = selected.name.replace(/\.[^.]+$/, "") + ".jpg";
      formData.set("file", new File([selected.blob], name, { type: "image/jpeg" }));
    }
    return importCvAction(previous, formData);
  }, {});

  useEffect(() => {
    if (selected?.kind !== "image") return;
    return () => URL.revokeObjectURL(selected.previewUrl);
  }, [selected]);

  const inputRef = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);

  /** Fichier déposé : on le place dans le champ (envoyé avec le formulaire) puis on le traite comme une sélection. */
  function onDrop(event: DragEvent<HTMLLabelElement>) {
    event.preventDefault();
    setDragging(false);
    const file = event.dataTransfer.files?.[0];
    if (!file || !inputRef.current) return;
    const transfer = new DataTransfer();
    transfer.items.add(file);
    inputRef.current.files = transfer.files;
    void handleFile(file);
  }

  async function onFileChange(event: ChangeEvent<HTMLInputElement>) {
    await handleFile(event.target.files?.[0]);
  }

  async function handleFile(file: File | undefined) {
    setSelected(null);
    setFileError(null);
    if (!file) return;

    if (isHeicFile(file)) {
      setFileError("Les photos HEIC (iPhone) ne sont pas prises en charge : convertis-la en JPG puis réessaie.");
      return;
    }
    if (!isImageFile(file)) {
      setSelected({ kind: "pdf", name: file.name, size: file.size });
      return;
    }

    setPreparing(true);
    try {
      const { blob, width, height } = await resizeImage(file);
      setSelected({ kind: "image", name: file.name, blob, width, height, previewUrl: URL.createObjectURL(blob) });
    } catch (error) {
      setFileError(error instanceof Error ? error.message : "Impossible de lire cette image.");
    } finally {
      setPreparing(false);
    }
  }

  const canSubmit = !pending && !preparing && (mode === "text" || (selected !== null && !fileError));

  return (
    <form action={formAction} className="flex flex-col gap-6">
      <input type="hidden" name="mode" value={mode} />

      <Tabs value={mode} onValueChange={(value) => setMode(value as Mode)}>
        <TabsList>
          <TabsTrigger value="file">Téléverser un fichier</TabsTrigger>
          <TabsTrigger value="text">Coller le texte</TabsTrigger>
        </TabsList>

        <TabsContent value="file" className="flex flex-col gap-3 pt-4">
          {/* Zone de dépôt (type « file upload » de 21st.dev) : clic ou glisser-déposer. */}
          <label
            htmlFor="cv-file"
            onDragOver={(event) => {
              event.preventDefault();
              setDragging(true);
            }}
            onDragLeave={() => setDragging(false)}
            onDrop={onDrop}
            className={cn(
              "relative grid cursor-pointer justify-items-center gap-2 overflow-hidden rounded-xl border-[1.5px] border-dashed border-foreground/25 px-5 py-9 text-center transition-colors hover:border-foreground/50 focus-within:ring-[3px] focus-within:ring-ring/50",
              dragging && "border-primary bg-accent",
              pending && "pointer-events-none",
            )}
          >
            {pending && <span className="scan-line" aria-hidden="true" />}
            <span aria-hidden="true" className="grid size-12 place-items-center rounded-xl bg-accent">
              <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                <path d="M12 16V4M7 9l5-5 5 5M5 20h14" />
              </svg>
            </span>
            <span className="text-base font-semibold">{dragging ? "Dépose le fichier" : selected ? "Changer de fichier" : "Dépose ton CV ici ou clique pour choisir"}</span>
            <span className="text-sm text-muted-foreground">PDF (5 Mo max) ou image : JPG, PNG, WebP</span>
            <input
              ref={inputRef}
              id="cv-file"
              name="file"
              type="file"
              accept=".pdf,.jpg,.jpeg,.png,.webp,.heic,.heif,application/pdf,image/jpeg,image/png,image/webp"
              onChange={onFileChange}
              disabled={pending}
              className="sr-only"
            />
          </label>
          <p className="text-sm text-muted-foreground">
            Une photo ou un PDF scanné est lu directement par l&apos;agent : ce qui est illisible est laissé vide, à toi de le compléter.
          </p>

          {preparing && <p className="text-sm text-muted-foreground">Préparation de l&apos;image…</p>}

          {fileError && (
            <Alert variant="destructive" aria-live="polite">
              <AlertTitle>Fichier non accepté</AlertTitle>
              <AlertDescription>{fileError}</AlertDescription>
            </Alert>
          )}

          {selected?.kind === "pdf" && (
            <p className="text-sm">
              PDF sélectionné : <span className="font-medium">{selected.name}</span> ({kilobytes(selected.size)})
            </p>
          )}

          {selected?.kind === "image" && (
            <figure className="flex flex-col gap-2">
              <div className="relative max-h-[28rem] overflow-auto rounded-lg border bg-muted/40 p-2" data-lenis-prevent>
                {pending && <span className="scan-line" aria-hidden="true" />}
                {/* URL blob locale : next/image n'apporte rien ici. */}
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={selected.previewUrl} alt="Aperçu du CV à analyser" className="mx-auto h-auto max-w-full" />
              </div>
              <figcaption className="text-sm text-muted-foreground">
                {selected.name} · envoyée en {selected.width} × {selected.height} px, {kilobytes(selected.blob.size)}. Vérifie
                que le texte est lisible avant de lancer l&apos;analyse.
              </figcaption>
            </figure>
          )}
        </TabsContent>

        <TabsContent value="text" className="flex flex-col gap-2 pt-4">
          <Label htmlFor="cv-text">Texte du CV</Label>
          <Textarea
            id="cv-text"
            name="text"
            rows={16}
            defaultValue={state.text}
            key={state.text ?? "empty"}
            placeholder="Colle ici le contenu de ton CV…"
            disabled={pending}
            data-lenis-prevent
          />
        </TabsContent>
      </Tabs>

      {state.error && (
        <Alert variant="destructive" aria-live="polite">
          <AlertTitle>Import impossible</AlertTitle>
          <AlertDescription>{state.error}</AlertDescription>
        </Alert>
      )}

      <div className="flex items-center gap-3">
        <Button type="submit" disabled={!canSubmit} className="btn-shine">
          {pending ? "Analyse en cours…" : "Analyser le CV"}
        </Button>
        {pending && <p className="text-sm text-muted-foreground">Extraction du profil par l&apos;agent, quelques secondes…</p>}
      </div>
      <p className="text-xs text-muted-foreground">
        Ton CV est envoyé à Cominty, le service d&apos;agent IA utilisé par LMAgent, pour être analysé. Rien n&apos;est
        enregistré dans ton profil tant que tu ne l&apos;as pas vérifié.
      </p>
    </form>
  );
}
