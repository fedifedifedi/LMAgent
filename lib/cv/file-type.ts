export type CvFileType = "pdf" | "jpeg" | "png" | "webp" | "heic";

const ascii = (bytes: Uint8Array, start: number, end: number) =>
  String.fromCharCode(...bytes.subarray(start, Math.min(end, bytes.length)));

// Marques ISO-BMFF des images HEIC/HEIF (photos d'iPhone).
const HEIC_BRANDS = new Set(["heic", "heix", "hevc", "hevx", "heim", "heis", "mif1", "msf1"]);

/** Type réel du fichier d'après ses premiers octets (l'extension et le type MIME envoyés ne sont pas fiables). */
export function detectCvFileType(bytes: Uint8Array): CvFileType | null {
  if (ascii(bytes, 0, 5) === "%PDF-") return "pdf";
  if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return "jpeg";
  if (ascii(bytes, 0, 8) === "\x89PNG\r\n\x1a\n") return "png";
  if (ascii(bytes, 0, 4) === "RIFF" && ascii(bytes, 8, 12) === "WEBP") return "webp";
  if (ascii(bytes, 4, 8) === "ftyp" && HEIC_BRANDS.has(ascii(bytes, 8, 12))) return "heic";
  return null;
}

export const MIME_TYPES = {
  pdf: "application/pdf",
  jpeg: "image/jpeg",
  png: "image/png",
  webp: "image/webp",
} as const;
