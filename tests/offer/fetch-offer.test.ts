import { describe, expect, test } from "bun:test";
import { extractJobPosting, fetchOffer, isPrivateAddress, MAX_OFFER_BYTES, OfferFetchError } from "@/lib/offer/fetch-offer";

const DESCRIPTION = "Nous recherchons un·e stagiaire développeur·se full-stack pour notre plateforme de réservation. ".repeat(6);

const html = (body: string, head = "") => `<!doctype html><html><head><title>Offre</title>${head}</head><body>${body}</body></html>`;
const page = (content: string, init: ResponseInit = {}) =>
  new Response(content, { status: 200, headers: { "content-type": "text/html; charset=utf-8" }, ...init });

/** Faux réseau : réponses par URL, DNS public par défaut ; enregistre les URL demandées. */
function fakeNet(routes: Record<string, () => Response>, dns: Record<string, string[]> = {}) {
  const requested: string[] = [];
  return {
    requested,
    deps: {
      lookup: async (host: string) => dns[host] ?? ["93.184.216.34"],
      fetch: (async (input: URL | RequestInfo) => {
        const url = input.toString();
        requested.push(url);
        const route = routes[url];
        if (!route) throw new TypeError("fetch failed");
        return route();
      }) as typeof fetch,
    },
  };
}

describe("isPrivateAddress", () => {
  test("adresses locales et privées refusées, publiques acceptées", () => {
    for (const ip of ["127.0.0.1", "10.2.3.4", "172.16.0.1", "192.168.1.10", "169.254.169.254", "100.64.0.1", "0.0.0.0", "::1", "fd00::1", "fe80::1", "::ffff:127.0.0.1"]) {
      expect(isPrivateAddress(ip)).toBe(true);
    }
    for (const ip of ["93.184.216.34", "8.8.8.8", "2606:4700::1111"]) expect(isPrivateAddress(ip)).toBe(false);
  });
});

describe("fetchOffer", () => {
  test("données structurées JobPosting lues en priorité", async () => {
    const ld = { "@context": "https://schema.org", "@graph": [{ "@type": "JobPosting", title: "Stage développeur full-stack", hiringOrganization: { name: "Ateliers Nova" }, jobLocation: { address: { addressLocality: "Lyon" } }, description: `<p>${DESCRIPTION}</p><ul><li>React</li><li>TypeScript</li></ul>` }] };
    const net = fakeNet({ "https://jobs.example/offre": () => page(html("<nav>menu</nav>", `<script type="application/ld+json">${JSON.stringify(ld)}</script>`)) });
    const { text } = await fetchOffer("https://jobs.example/offre", net.deps);

    expect(text.startsWith("Stage développeur full-stack\nAteliers Nova\nLyon")).toBe(true);
    expect(text).toContain("React\nTypeScript");
  });

  test("sans données structurées : contenu principal de la page", async () => {
    const net = fakeNet({ "https://jobs.example/a": () => page(html(`<header>Menu</header><main><article><h1>Stage data</h1><p>${DESCRIPTION}</p></article></main>`)) });
    const { text } = await fetchOffer("https://jobs.example/a", net.deps);
    expect(text).toContain("plateforme de réservation");
  });

  test("LinkedIn qui bloque (999) : message dédié invitant à coller le texte", async () => {
    const net = fakeNet({ "https://www.linkedin.com/jobs/view/1": () => page("", { status: 999 }) });
    await expect(fetchOffer("https://www.linkedin.com/jobs/view/1", net.deps)).rejects.toThrow(
      "LinkedIn bloque la lecture automatique des offres : copie le texte de l'offre et colle-le ici.",
    );
  });

  test("mur de connexion (page presque vide) : refus avec message", async () => {
    const net = fakeNet({ "https://jobs.example/login": () => page(html("<p>Connectez-vous pour voir cette offre.</p>")) });
    await expect(fetchOffer("https://jobs.example/login", net.deps)).rejects.toThrow(/ne contient pas le texte de l'offre/);
  });

  test("adresse privée refusée avant toute requête, y compris par le DNS", async () => {
    const net = fakeNet({}, { "intranet.example": ["10.0.0.5"] });
    await expect(fetchOffer("http://127.0.0.1/admin", net.deps)).rejects.toThrow(/adresse locale ou privée/);
    await expect(fetchOffer("https://intranet.example/x", net.deps)).rejects.toThrow(/adresse locale ou privée/);
    await expect(fetchOffer("http://[::1]/", net.deps)).rejects.toThrow(/adresse locale ou privée/);
    expect(net.requested).toEqual([]);
  });

  test("redirection vers une adresse privée refusée", async () => {
    const net = fakeNet({
      "https://jobs.example/r": () => new Response(null, { status: 302, headers: { location: "http://169.254.169.254/latest/meta-data" } }),
    });
    await expect(fetchOffer("https://jobs.example/r", net.deps)).rejects.toBeInstanceOf(OfferFetchError);
    expect(net.requested).toEqual(["https://jobs.example/r"]);
  });

  test("schéma, port et identifiants non autorisés", async () => {
    const net = fakeNet({});
    await expect(fetchOffer("file:///etc/passwd", net.deps)).rejects.toThrow(/http et https/);
    await expect(fetchOffer("https://jobs.example:8443/x", net.deps)).rejects.toThrow(/port/);
    await expect(fetchOffer("https://user:pass@jobs.example/x", net.deps)).rejects.toThrow(/identifiants/);
    await expect(fetchOffer("pas une url", net.deps)).rejects.toThrow(/adresse web valide/);
  });

  test("page trop lourde et contenu non HTML refusés", async () => {
    const big = "x".repeat(MAX_OFFER_BYTES + 10);
    const net = fakeNet({
      "https://jobs.example/big": () => page(big),
      "https://jobs.example/doc.pdf": () => new Response("%PDF-1.7", { headers: { "content-type": "application/pdf" } }),
    });
    await expect(fetchOffer("https://jobs.example/big", net.deps)).rejects.toThrow(/trop lourde/);
    await expect(fetchOffer("https://jobs.example/doc.pdf", net.deps)).rejects.toThrow(/ne mène pas à une page web/);
  });

  test("site injoignable : message invitant à coller le texte", async () => {
    await expect(fetchOffer("https://down.example/x", fakeNet({}).deps)).rejects.toThrow(/colle-le ici/);
  });

  test("extractJobPosting : JSON-LD invalide ignoré", () => {
    expect(extractJobPosting(`<script type="application/ld+json">{oops</script>`)).toBeNull();
  });
});
