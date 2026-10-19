import { Readability } from "@mozilla/readability";
import { lookup as dnsLookup } from "node:dns/promises";
import { isIP } from "node:net";
import { parseHTML } from "linkedom";
import { normalizeText } from "@/lib/offer/text";

export const MAX_OFFER_BYTES = 2 * 1024 * 1024;
export const FETCH_TIMEOUT_MS = 10_000;
const MAX_REDIRECTS = 3;
/** En dessous, la page ne contient pas l'offre (mur de connexion, page vide, captcha). */
export const MIN_OFFER_CHARS = 300;

/** Erreur à afficher telle quelle ; l'interface propose alors de coller le texte de l'offre. */
export class OfferFetchError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "OfferFetchError";
  }
}

export type OfferFetchDeps = {
  fetch?: typeof fetch;
  /** Résolution DNS (toutes les adresses) ; injectée dans les tests. */
  lookup?: (hostname: string) => Promise<string[]>;
};

const defaultLookup = async (hostname: string) => (await dnsLookup(hostname, { all: true, verbatim: true })).map((a) => a.address);

// Sites qui bloquent souvent la lecture automatique : message dédié en cas d'échec.
const KNOWN_SITES: Array<[RegExp, string]> = [
  [/(^|\.)linkedin\.com$/i, "LinkedIn"],
  [/(^|\.)indeed\.[a-z.]+$/i, "Indeed"],
  [/(^|\.)glassdoor\.[a-z.]+$/i, "Glassdoor"],
  [/(^|\.)welcometothejungle\.com$/i, "Welcome to the Jungle"],
];

function pasteMessage(host: string, reason: string) {
  const site = KNOWN_SITES.find(([pattern]) => pattern.test(host))?.[1];
  return site
    ? `${site} bloque la lecture automatique des offres : copie le texte de l'offre et colle-le ici.`
    : `Impossible de lire cette page (${reason}) : copie le texte de l'offre et colle-le ici.`;
}

/** Adresses non publiques : le serveur ne doit jamais aller les chercher pour un utilisateur (SSRF). */
export function isPrivateAddress(ip: string): boolean {
  const mapped = ip.toLowerCase().match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
  if (mapped) return isPrivateAddress(mapped[1]);
  if (isIP(ip) === 4) {
    const [a, b] = ip.split(".").map(Number);
    return (
      a === 0 || a === 10 || a === 127 || a >= 224 ||
      (a === 100 && b >= 64 && b <= 127) ||
      (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168) ||
      (a === 192 && b === 0) ||
      (a === 198 && (b === 18 || b === 19))
    );
  }
  if (isIP(ip) === 6) {
    const v = ip.toLowerCase();
    return v === "::" || v === "::1" || /^f[cd]/.test(v) || /^fe[89ab]/.test(v) || /^ff/.test(v);
  }
  return true;
}

async function assertPublicUrl(raw: string, lookup: NonNullable<OfferFetchDeps["lookup"]>): Promise<URL> {
  let url: URL;
  try {
    url = new URL(raw.trim());
  } catch {
    throw new OfferFetchError("Ce lien n'est pas une adresse web valide.");
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") throw new OfferFetchError("Seuls les liens http et https sont acceptés.");
  if (url.port && url.port !== "80" && url.port !== "443") throw new OfferFetchError("Ce lien utilise un port non autorisé.");
  if (url.username || url.password) throw new OfferFetchError("Les liens avec identifiants ne sont pas acceptés.");

  const host = url.hostname.replace(/^\[|\]$/g, "");
  let addresses: string[];
  try {
    addresses = isIP(host) ? [host] : await lookup(host);
  } catch {
    throw new OfferFetchError("Ce site est introuvable : vérifie le lien, ou colle le texte de l'offre.");
  }
  // Limite connue : fetch résout de nouveau le nom (rebinding DNS théorique) ; acceptable pour une app locale.
  if (addresses.length === 0 || addresses.some(isPrivateAddress)) {
    throw new OfferFetchError("Ce lien pointe vers une adresse locale ou privée : il n'est pas accepté.");
  }
  return url;
}

async function readLimited(response: Response): Promise<string> {
  const declared = Number(response.headers.get("content-length"));
  if (declared > MAX_OFFER_BYTES) throw new OfferFetchError("La page est trop lourde : colle le texte de l'offre.");
  const reader = response.body?.getReader();
  if (!reader) return "";
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > MAX_OFFER_BYTES) {
      await reader.cancel();
      throw new OfferFetchError("La page est trop lourde : colle le texte de l'offre.");
    }
    chunks.push(value);
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return new TextDecoder().decode(bytes);
}

type JsonLdNode = Record<string, unknown>;

function* walkJsonLd(value: unknown): Generator<JsonLdNode> {
  if (Array.isArray(value)) for (const item of value) yield* walkJsonLd(item);
  else if (value && typeof value === "object") {
    const node = value as JsonLdNode;
    yield node;
    if (node["@graph"]) yield* walkJsonLd(node["@graph"]);
  }
}

function htmlToText(html: string): string {
  const { document } = parseHTML(`<!doctype html><html><body>${html.replace(/<br\s*\/?>/gi, "\n").replace(/<\/(p|li|h\d|div)>/gi, "\n")}</body></html>`);
  return document.body.textContent ?? "";
}

const asText = (value: unknown): string | undefined =>
  typeof value === "string" ? value : value && typeof value === "object" && typeof (value as JsonLdNode).name === "string" ? ((value as JsonLdNode).name as string) : undefined;

/** Données structurées schema.org JobPosting : titre, entreprise, lieu et description, quand la page les publie. */
export function extractJobPosting(html: string): string | null {
  const scripts = html.match(/<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi) ?? [];
  for (const script of scripts) {
    const json = script.replace(/^<script[^>]*>/i, "").replace(/<\/script>$/i, "");
    let parsed: unknown;
    try {
      parsed = JSON.parse(json);
    } catch {
      continue;
    }
    for (const node of walkJsonLd(parsed)) {
      const type = node["@type"];
      if (!(type === "JobPosting" || (Array.isArray(type) && type.includes("JobPosting")))) continue;
      const location = [node.jobLocation].flat().map((l) => {
        const address = (l as JsonLdNode | undefined)?.address as JsonLdNode | undefined;
        return [address?.addressLocality, address?.addressCountry].map(asText).filter(Boolean).join(", ");
      });
      const lines = [
        asText(node.title),
        asText(node.hiringOrganization),
        location.filter(Boolean).join(" ; "),
        [node.employmentType].flat().filter((t) => typeof t === "string").join(", "),
        "",
        typeof node.description === "string" ? htmlToText(node.description) : "",
      ];
      const text = normalizeText(lines.filter((line) => line !== undefined).join("\n"));
      if (text.length >= MIN_OFFER_CHARS) return text;
    }
  }
  return null;
}

/** Contenu principal de la page (Readability), à défaut de données structurées. */
export function extractMainText(html: string): string | null {
  const { document } = parseHTML(html);
  try {
    const article = new Readability(document as unknown as Document, { charThreshold: 200 }).parse();
    const text = normalizeText([article?.title, article?.textContent].filter(Boolean).join("\n\n"));
    if (text.length >= MIN_OFFER_CHARS) return text;
  } catch {
    // Page que Readability ne sait pas analyser : on essaie le texte brut du body.
  }
  const fallback = normalizeText(document.body?.textContent ?? "");
  return fallback.length >= MIN_OFFER_CHARS ? fallback : null;
}

/**
 * Texte d'une offre d'emploi à partir de son lien, récupéré côté serveur. Refuse les adresses privées (aussi après
 * redirection), limite la taille et le délai. Toute impossibilité devient une OfferFetchError qui invite à coller le texte.
 */
export async function fetchOffer(rawUrl: string, deps: OfferFetchDeps = {}): Promise<{ text: string; url: string }> {
  const fetchImpl = deps.fetch ?? fetch;
  const lookup = deps.lookup ?? defaultLookup;
  let url = await assertPublicUrl(rawUrl, lookup);

  let response: Response | undefined;
  for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
    try {
      response = await fetchImpl(url, {
        redirect: "manual",
        signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
        headers: { "user-agent": "LMAgent/1.0 (lecture d'une offre d'emploi)", accept: "text/html,application/xhtml+xml,text/plain;q=0.9" },
      });
    } catch (error) {
      const timeout = error instanceof Error && (error.name === "TimeoutError" || error.name === "AbortError");
      throw new OfferFetchError(pasteMessage(url.hostname, timeout ? "le site met trop de temps à répondre" : "le site ne répond pas"));
    }
    const location = response.headers.get("location");
    if (response.status >= 300 && response.status < 400 && location) {
      if (hop === MAX_REDIRECTS) throw new OfferFetchError(pasteMessage(url.hostname, "trop de redirections"));
      url = await assertPublicUrl(new URL(location, url).toString(), lookup);
      continue;
    }
    break;
  }

  if (!response || !response.ok) throw new OfferFetchError(pasteMessage(url.hostname, `réponse ${response?.status ?? "vide"}`));
  const type = response.headers.get("content-type") ?? "";
  if (!/text\/html|application\/xhtml|text\/plain/i.test(type)) {
    throw new OfferFetchError("Ce lien ne mène pas à une page web (PDF, image…) : colle le texte de l'offre.");
  }

  const body = await readLimited(response);
  const text = /text\/plain/i.test(type) ? normalizeText(body) : (extractJobPosting(body) ?? extractMainText(body));
  if (!text || text.length < MIN_OFFER_CHARS) throw new OfferFetchError(pasteMessage(url.hostname, "la page ne contient pas le texte de l'offre"));
  return { text, url: url.toString() };
}
