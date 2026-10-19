// Redimensionnement côté navigateur (canvas), sans module natif côté serveur.

/** Assez pour lire un CV A4 photographié, léger à envoyer (en général moins de 1 Mo en JPEG). */
export const MAX_IMAGE_SIDE = 2000;
export const JPEG_QUALITY = 0.85;

/** Dimensions réduites pour que le grand côté tienne dans maxSide (jamais agrandies). */
export function fitWithin(width: number, height: number, maxSide = MAX_IMAGE_SIDE) {
  const scale = Math.min(1, maxSide / Math.max(width, height));
  return { width: Math.max(1, Math.round(width * scale)), height: Math.max(1, Math.round(height * scale)) };
}

export function isHeicFile(file: { name: string; type: string }) {
  return /^image\/hei[cf]/i.test(file.type) || /\.hei[cf]$/i.test(file.name);
}

export function isImageFile(file: { name: string; type: string }) {
  return /^image\/(jpeg|png|webp)$/i.test(file.type) || /\.(jpe?g|png|webp)$/i.test(file.name);
}

/** Redimensionne et ré-encode en JPEG (orientation EXIF appliquée, transparence sur fond blanc). */
export async function resizeImage(file: Blob): Promise<{ blob: Blob; width: number; height: number }> {
  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(file, { imageOrientation: "from-image" });
  } catch {
    throw new Error("Impossible de lire cette image. Essaie une autre photo ou un PDF.");
  }

  const { width, height } = fitWithin(bitmap.width, bitmap.height);
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext("2d");
  if (!context) throw new Error("Ton navigateur ne permet pas de préparer l'image.");
  // Un PNG transparent deviendrait noir en JPEG.
  context.fillStyle = "#ffffff";
  context.fillRect(0, 0, width, height);
  context.imageSmoothingQuality = "high";
  context.drawImage(bitmap, 0, 0, width, height);
  bitmap.close();

  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/jpeg", JPEG_QUALITY));
  if (!blob) throw new Error("Impossible de préparer l'image.");
  return { blob, width, height };
}
