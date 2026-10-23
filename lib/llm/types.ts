import type { z } from "zod";

export type ProviderName = "mock" | "cominty";

export type TokenUsage = {
  inputTokens: number;
  outputTokens: number;
  /** Tokens d'entrée servis depuis le cache (sous-ensemble de inputTokens). */
  cacheReadTokens?: number;
  /** Coût facturé en dollars, quand le provider le donne (Cominty). */
  costUsd?: number;
  /** true pour le mock : estimation (~4 caractères par token), pas un comptage réel. */
  estimated?: boolean;
};

/** Consommation d'un appel generateObject, cumulée sur toutes ses tentatives. */
export type LLMUsage = TokenUsage & {
  provider: ProviderName;
  model: string;
  attempts: number;
  durationMs: number;
};

/** Historique neutre ; `native` porte la réponse brute du provider pour la lui renvoyer telle quelle. */
export type ConversationTurn = { role: "user"; text: string } | { role: "assistant"; text: string; native?: unknown };

/**
 * Effort de réflexion demandé au modèle. Bas pour la recopie structurée (extraction), plus élevé pour la
 * rédaction et la critique. Non défini : défaut du modèle.
 */
export type ReasoningLevel = "low" | "medium" | "high";

export type AttachmentMimeType = "application/pdf" | "image/jpeg" | "image/png" | "image/webp";

/** Fichier lu nativement par le modèle (CV en image, PDF scanné), joint au premier message utilisateur. */
export type Attachment = { mimeType: AttachmentMimeType; data: Uint8Array };

export type CompletionRequest = {
  reasoning?: ReasoningLevel;
  /** Renvoyés à chaque tentative (ils font partie du premier message) : une relance coûte leur lecture à nouveau. */
  attachments?: Attachment[];
  /** Nom de la sortie (clé des fixtures mock). */
  name: string;
  jsonSchema: Record<string, unknown>;
  system: string;
  turns: ConversationTurn[];
  maxOutputTokens: number;
  /** Abandon demandé par l'appelant (délai dépassé). */
  signal?: AbortSignal;
};

export type Completion = {
  /** Texte JSON brut produit par le modèle. */
  text: string;
  usage: TokenUsage;
  native?: unknown;
};

/** Un provider ne fait que traduire une requête vers son API : validation et relances sont dans generateObject. */
export interface LLMProvider {
  readonly name: ProviderName;
  readonly model: string;
  complete(request: CompletionRequest): Promise<Completion>;
}

export type LLMOutput<T extends z.ZodObject = z.ZodObject, L extends z.ZodType = z.ZodType> = {
  name: string;
  schema: T;
  lenientSchema?: L;
};
