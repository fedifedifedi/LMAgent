import type { ComintyMessage } from "@/lib/cominty/schemas";

export class ComintyError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = new.target.name;
  }
}

/** Configuration manquante ou invalide (COMINTY_API_KEY, COMINTY_USER_ID, COMINTY_AGENT_ID). Jamais la valeur. */
export class ComintyConfigError extends ComintyError {}

/** Réponse HTTP en erreur de l'API Cominty. `detail` : message du serveur quand il en donne un. */
export class ComintyApiError extends ComintyError {
  constructor(
    readonly status: number,
    readonly detail: string | undefined,
    message: string,
    options?: ErrorOptions,
  ) {
    super(message, options);
  }
}

/** Clé refusée ou droits insuffisants (401, 403). */
export class ComintyAuthError extends ComintyApiError {}

/** Limite atteinte (429) ou crédits épuisés, avec le délai conseillé quand l'API le donne. */
export class ComintyRateLimitError extends ComintyApiError {
  constructor(
    status: number,
    detail: string | undefined,
    readonly retryAfterSeconds: number | undefined,
    message: string,
  ) {
    super(status, detail, message);
  }
}

/** Flux interrompu avant le message final (arrêt du serveur, coupure réseau) : reprenable avec lastEventId. */
export class ComintyStreamError extends ComintyError {
  constructor(
    message: string,
    readonly lastEventId: string | undefined,
    readonly partial?: ComintyMessage,
    options?: ErrorOptions,
  ) {
    super(message, options);
  }
}

/** Traduit une réponse en erreur : messages en français, sans jamais reprendre la clé ni les en-têtes. */
export function errorFromResponse(status: number, body: unknown, headers: Headers): ComintyApiError {
  const raw = body && typeof body === "object" ? (body as Record<string, unknown>).detail : undefined;
  const detail = typeof raw === "string" ? raw : undefined;
  const suffix = detail ? ` (${detail})` : "";
  if (status === 401 || status === 403) {
    return new ComintyAuthError(status, detail, `Cominty refuse l'accès (HTTP ${status}) : vérifie COMINTY_API_KEY et COMINTY_USER_ID${suffix}.`);
  }
  if (status === 429) {
    const retryAfter = Number(headers.get("retry-after"));
    const seconds = Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter : undefined;
    const wait = seconds ? ` Réessaie dans ${seconds} s.` : " Réessaie plus tard.";
    return new ComintyRateLimitError(status, detail, seconds, `Limite Cominty atteinte${suffix}.${wait}`);
  }
  return new ComintyApiError(status, detail, `Cominty a répondu HTTP ${status}${suffix}.`);
}
