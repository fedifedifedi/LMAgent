import "server-only";
import { existsSync } from "node:fs";
import puppeteer, { type Browser } from "puppeteer-core";
import { neutralizePdfMetadata } from "@/lib/pdf/metadata";

/** Erreur à afficher telle quelle (configuration d'Edge, rendu impossible). */
export class PdfError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PdfError";
  }
}

const IDLE_CLOSE_MS = 5 * 60 * 1000;
const EDGE_HINT = "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe";

let browser: Promise<Browser> | null = null;
let idleTimer: ReturnType<typeof setTimeout> | undefined;

/** Une seule instance d'Edge (lancement ~1 s), fermée après quelques minutes sans export. */
async function getBrowser(): Promise<Browser> {
  const executablePath = process.env.CHROME_PATH?.trim();
  if (!executablePath) {
    throw new PdfError(`Export PDF : ajoute CHROME_PATH dans .env.local avec le chemin de Microsoft Edge (par exemple ${EDGE_HINT}), puis relance l'application.`);
  }
  if (!existsSync(executablePath)) throw new PdfError(`Export PDF : CHROME_PATH ne mène à aucun fichier (${executablePath}). Vérifie le chemin d'Edge dans .env.local.`);

  browser ??= puppeteer
    .launch({ executablePath, headless: true, args: ["--no-first-run", "--no-default-browser-check", "--disable-extensions", "--disable-gpu"] })
    .catch((error: unknown) => {
      browser = null;
      throw new PdfError(`Impossible de lancer Edge pour l'export PDF (${error instanceof Error ? error.message : String(error)}).`);
    });
  return browser;
}

function scheduleClose() {
  clearTimeout(idleTimer);
  idleTimer = setTimeout(async () => {
    const current = browser;
    browser = null;
    await (await current)?.close().catch(() => {});
  }, IDLE_CLOSE_MS);
  idleTimer.unref?.();
}

export type RenderedPdf = { pdf: Uint8Array; scale: number; overflow: boolean };

/**
 * Imprime la page `url` (page d'impression de la lettre) en PDF A4. Si la feuille déborde, le texte est réduit par
 * petits pas jusqu'à `minScale` (≈ 10 pt) ; au-delà, le PDF est produit quand même avec overflow = true.
 */
export async function renderPdf(url: string, minScale: number): Promise<RenderedPdf> {
  const instance = await getBrowser();
  const page = await instance.newPage();
  try {
    await page.emulateMediaType("print");
    // Thème clair quel que soit le réglage de Windows : le script de thème ne pose pas .dark.
    await page.emulateMediaFeatures([{ name: "prefers-color-scheme", value: "light" }]);
    const response = await page.goto(url, { waitUntil: "networkidle0", timeout: 30_000 });
    if (!response?.ok()) throw new PdfError(`La page d'impression ne répond pas (${response?.status() ?? "aucune réponse"}).`);
    await page.waitForSelector("[data-letter-sheet]", { timeout: 15_000 });
    await page.evaluate(() => document.fonts.ready.then(() => undefined));

    const overflows = () =>
      page.evaluate(() => {
        const sheet = document.querySelector<HTMLElement>("[data-letter-sheet]")!;
        return sheet.scrollHeight > sheet.clientHeight + 1;
      });

    let scale = 1;
    let overflow = await overflows();
    while (overflow && scale > minScale) {
      scale = Math.max(minScale, Math.round((scale - 0.02) * 1000) / 1000);
      await page.evaluate((value) => document.querySelector<HTMLElement>("[data-letter-sheet]")!.style.setProperty("--letter-scale", String(value)), scale);
      overflow = await overflows();
    }

    const printed = await page.pdf({ format: "A4", printBackground: true, preferCSSPageSize: true, margin: { top: 0, right: 0, bottom: 0, left: 0 } });
    // Pas de trace de l'outil ni du navigateur dans les métadonnées (Creator, Producer, XMP).
    const pdf = await neutralizePdfMetadata(printed, await page.title());
    return { pdf, scale, overflow };
  } finally {
    await page.close().catch(() => {});
    scheduleClose();
  }
}
