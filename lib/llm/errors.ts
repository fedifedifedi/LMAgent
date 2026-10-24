import type { LLMUsage, ProviderName } from "@/lib/llm/types";

export class LLMError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = new.target.name;
  }
}

/** Configuration manquante ou invalide (LLM_PROVIDER, COMINTY_*, fixture absente). */
export class LLMConfigError extends LLMError {}

/** Limite de requêtes atteinte (HTTP 429), avec le délai conseillé quand l'API le fournit. */
export class LLMRateLimitError extends LLMError {
  constructor(
    readonly provider: ProviderName,
    readonly retryAfterSeconds: number | undefined,
    message: string,
    options?: ErrorOptions & { daily?: boolean },
  ) {
    super(message, options);
    this.daily = options?.daily ?? false;
  }
  /** Quota du jour épuisé (pas une simple limite par minute) : rien à faire avant le lendemain. */
  readonly daily: boolean;
}

/** Réponse inexploitable indépendamment du schéma : refus, sortie tronquée, réponse vide. */
export class LLMResponseError extends LLMError {}

/** Toutes les tentatives ont produit une sortie invalide pour le schéma cible. */
export class LLMValidationError extends LLMError {
  constructor(
    readonly outputName: string,
    readonly issues: string,
    readonly lastResponse: string,
    readonly usage: LLMUsage,
  ) {
    super(`Sortie "${outputName}" invalide après ${usage.attempts} tentative(s) :\n${issues}`);
  }
}
