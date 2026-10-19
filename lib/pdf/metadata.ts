import { PDFDocument, PDFName } from "pdf-lib";

/**
 * Métadonnées neutres : Creator et Producer vidés (Edge y écrit « HeadlessChrome » et « Skia/PDF »), XMP retiré
 * s'il existe, titre conservé (objet de la lettre). Le contenu des pages n'est pas touché.
 */
export async function neutralizePdfMetadata(bytes: Uint8Array, title?: string): Promise<Uint8Array> {
  const document = await PDFDocument.load(bytes, { updateMetadata: false });
  document.setCreator("");
  document.setProducer("");
  if (title) document.setTitle(title);
  document.catalog.delete(PDFName.of("Metadata"));
  return document.save({ updateFieldAppearances: false });
}
