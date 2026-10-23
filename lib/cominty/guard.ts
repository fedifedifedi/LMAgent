import { createHash, timingSafeEqual } from "node:crypto";
import type { ComintyClient } from "@/lib/cominty/client";
import { ComintyError } from "@/lib/cominty/errors";
import type { ComintyMessage } from "@/lib/cominty/schemas";
import type { StreamItem } from "@/lib/cominty/stream";
import { db } from "@/lib/db";

/**
 * Protection des crédits Cominty avant un déploiement public :
 * - code d'accès (DEMO_ACCESS_CODE) obligatoire pour lancer un vrai appel ;
 * - plafond global de dépense (COMINTY_BUDGET_USD, 3 $ par défaut) : plus aucun appel une fois atteint.
 * La dépense est comptée dans ComintyCharge, une ligne par message facturé (événement result).
 */

export const ACCESS_COOKIE = "lmagent_access";
export const DEFAULT_BUDGET_USD = 3;

/** Un appel réel nécessite un code d'accès ou le plafond est atteint. Message affiché tel quel. */
export class ComintyGuardError extends ComintyError {
  constructor(
    readonly reason: "access" | "budget",
    message: string,
  ) {
    super(message);
  }
}

export const ACCESS_REQUIRED_MESSAGE =
  "Code d'accès requis pour lancer l'agent Cominty (appel payant). Saisis-le sur la page « Code d'accès », ou essaie la démo enregistrée depuis l'accueil.";

/** Code d'accès exigé : dès qu'il est défini, et toujours en production (un oubli ne doit pas ouvrir les crédits). */
export function accessRequired(env: Record<string, string | undefined> = process.env): boolean {
  return Boolean(env.DEMO_ACCESS_CODE?.trim()) || env.NODE_ENV === "production";
}

export const hashAccessCode = (code: string) => createHash("sha256").update(code.trim()).digest("hex");

/** Le cookie contient l'empreinte du code (jamais le code) ; comparaison à temps constant. */
export function cookieGrantsAccess(cookieValue: string | undefined, env: Record<string, string | undefined> = process.env): boolean {
  if (!accessRequired(env)) return true;
  const code = env.DEMO_ACCESS_CODE?.trim();
  if (!code || !cookieValue) return false;
  const expected = Buffer.from(hashAccessCode(code));
  const given = Buffer.from(cookieValue);
  return given.length === expected.length && timingSafeEqual(given, expected);
}

export function budgetUsd(env: Record<string, string | undefined> = process.env): number {
  const value = Number(env.COMINTY_BUDGET_USD);
  return Number.isFinite(value) && value >= 0 && env.COMINTY_BUDGET_USD?.trim() ? value : DEFAULT_BUDGET_USD;
}

export async function spentUsd(): Promise<number> {
  const { _sum } = await db.comintyCharge.aggregate({ _sum: { costUsd: true } });
  return _sum.costUsd ?? 0;
}

const usd = (value: number) => value.toLocaleString("fr-FR", { style: "currency", currency: "USD", minimumFractionDigits: 2 });

/** Bloque tout nouvel appel quand le plafond est atteint. */
export async function assertBudget(env: Record<string, string | undefined> = process.env): Promise<void> {
  const [spent, budget] = [await spentUsd(), budgetUsd(env)];
  if (spent >= budget) {
    throw new ComintyGuardError(
      "budget",
      `Plafond de dépense Cominty atteint (${usd(spent)} sur ${usd(budget)}) : aucun nouvel appel n'est lancé. Augmente COMINTY_BUDGET_USD pour continuer.`,
    );
  }
}

/** Vérifications avant de lancer un vrai appel : code d'accès, puis plafond. */
export async function assertRealCallAllowed(access: boolean, env: Record<string, string | undefined> = process.env): Promise<void> {
  if (!access) throw new ComintyGuardError("access", ACCESS_REQUIRED_MESSAGE);
  await assertBudget(env);
}

type GuardedClient = Pick<ComintyClient, "agentId" | "startChat" | "sendMessage" | "stream" | "waitForMessage" | "cancel" | "uploadFile">;

/**
 * Client réel protégé : chaque nouveau message vérifie le plafond, chaque événement result est enregistré dans
 * ComintyCharge (une seule fois par message, même si le flux est relu). L'accès est vérifié par les actions.
 */
export function guardedClient(client: ComintyClient, env: Record<string, string | undefined> = process.env): GuardedClient {
  async function* stream(messageId: string, options: { lastEventId?: string; signal?: AbortSignal } = {}): AsyncGenerator<StreamItem> {
    for await (const item of client.stream(messageId, options)) {
      if (item.type === "event" && item.event.name === "result") {
        const { cost } = item.event.data;
        await db.comintyCharge.upsert({
          where: { messageId },
          create: { messageId, costUsd: cost.total, inputTokens: cost.input_tokens, outputTokens: cost.output_tokens },
          update: {},
        });
      }
      yield item;
    }
  }
  return {
    agentId: client.agentId,
    async startChat(...args) {
      await assertBudget(env);
      return client.startChat(...args);
    },
    async sendMessage(...args) {
      await assertBudget(env);
      return client.sendMessage(...args);
    },
    stream,
    async waitForMessage(messageId, options = {}): Promise<ComintyMessage> {
      for await (const item of stream(messageId, options)) {
        if (item.type === "event") options.onEvent?.(item.event);
        else return item.message;
      }
      throw new ComintyError("Le flux Cominty s'est terminé sans réponse finale.");
    },
    cancel: (messageId) => client.cancel(messageId),
    async uploadFile(...args) {
      await assertBudget(env);
      return client.uploadFile(...args);
    },
  };
}
