import { readComintyConfig, type ComintyConfig } from "@/lib/cominty/config";
import { ComintyError, ComintyStreamError, errorFromResponse } from "@/lib/cominty/errors";
import { MessageSchema, ThreadSchema, type ComintyEvent, type ComintyMessage } from "@/lib/cominty/schemas";
import { parseStream, readJsonLines, type StreamItem } from "@/lib/cominty/stream";

/** Plafond par défaut des tours d'outils d'un message : l'app fournit déjà le profil et l'offre en texte. */
export const DEFAULT_MAX_STEPS = 3;
/** Au plus 5 fichiers par message (limite de l'API). */
export const MAX_FILES_PER_MESSAGE = 5;

export type SendOptions = { fileIds?: string[]; maxSteps?: number; signal?: AbortSignal };
export type StartedMessage = { threadId: string; messageId: string };

export type ComintyClient = ReturnType<typeof createComintyClient>;

/**
 * Client REST de l'API Cominty (agents managés), écrit d'après le SDK Python officiel : POST /chat,
 * POST /chat/{thread}, flux GET /chat/messages/{id}/stream (application/jsonl), annulation, fichiers.
 * Côté serveur uniquement : la clé part dans l'en-tête x-cominty-token, jamais vers le stockage des fichiers.
 */
export function createComintyClient(config: ComintyConfig = readComintyConfig(), fetchImpl: typeof fetch = fetch) {
  async function request(method: string, route: string, init: { body?: unknown; query?: Record<string, string>; headers?: Record<string, string>; signal?: AbortSignal } = {}) {
    const url = new URL(config.baseUrl + route);
    for (const [key, value] of Object.entries(init.query ?? {})) url.searchParams.set(key, value);
    let response: Response;
    try {
      response = await fetchImpl(url, {
        method,
        headers: { "x-cominty-token": config.apiKey, ...(init.body ? { "content-type": "application/json" } : {}), ...init.headers },
        body: init.body ? JSON.stringify(init.body) : undefined,
        signal: init.signal,
      });
    } catch (error) {
      if (error instanceof Error && error.name === "AbortError") throw error;
      throw new ComintyError(`Cominty injoignable (${method} ${route}).`, { cause: error });
    }
    if (!response.ok) throw errorFromResponse(response.status, await response.json().catch(() => undefined), response.headers);
    return response;
  }

  function messageBody(content: string, options: SendOptions) {
    if ((options.fileIds?.length ?? 0) > MAX_FILES_PER_MESSAGE) throw new ComintyError(`Au plus ${MAX_FILES_PER_MESSAGE} fichiers par message.`);
    const maxSteps = options.maxSteps ?? DEFAULT_MAX_STEPS;
    if (!Number.isInteger(maxSteps) || maxSteps < 1) throw new ComintyError("maxSteps doit être un entier ≥ 1.");
    return {
      message: { content, ...(options.fileIds?.length ? { file_ids: options.fileIds } : {}) },
      options: { agent_id: config.agentId, user_id: config.userId, max_steps: maxSteps },
    };
  }

  /** Le dernier message assistant de la conversation est celui qui est en cours (cf. SDK). */
  async function started(response: Response): Promise<StartedMessage> {
    const thread = ThreadSchema.parse(await response.json());
    const assistant = thread.messages.findLast((message) => message.role === "assistant");
    if (!assistant) throw new ComintyError("Cominty n'a pas créé de message assistant.");
    return { threadId: thread.id, messageId: assistant.id };
  }

  return {
    agentId: config.agentId,

    /** Démarre une conversation avec l'agent configuré ; la réponse se suit avec stream(messageId). */
    async startChat(content: string, options: SendOptions = {}): Promise<StartedMessage> {
      return started(await request("POST", "/chat", { body: messageBody(content, options), signal: options.signal }));
    },

    /**
     * Message suivant dans une conversation existante (dont la réponse à une question de l'agent).
     * Contrairement à POST /chat, la réponse est le nouveau message assistant, pas la conversation (cf. SDK).
     */
    async sendMessage(threadId: string, content: string, options: SendOptions = {}): Promise<StartedMessage> {
      const response = await request("POST", `/chat/${encodeURIComponent(threadId)}`, { body: messageBody(content, options), signal: options.signal });
      const message = MessageSchema.parse(await response.json());
      return { threadId: message.thread_id, messageId: message.id };
    },

    /** Événements du message puis le message final. lastEventId : reprise après coupure, sans relancer l'agent. */
    async *stream(messageId: string, options: { lastEventId?: string; signal?: AbortSignal } = {}): AsyncGenerator<StreamItem> {
      const response = await request("GET", `/chat/messages/${encodeURIComponent(messageId)}/stream`, {
        headers: options.lastEventId ? { "last-event-id": options.lastEventId } : undefined,
        signal: options.signal,
      });
      if (!response.body) throw new ComintyStreamError("Cominty n'a pas renvoyé de flux.", options.lastEventId);
      yield* parseStream(readJsonLines(response.body));
    },

    /** Suit le flux jusqu'au message final, en transmettant chaque événement. */
    async waitForMessage(messageId: string, options: { lastEventId?: string; signal?: AbortSignal; onEvent?: (event: ComintyEvent) => void } = {}): Promise<ComintyMessage> {
      for await (const item of this.stream(messageId, options)) {
        if (item.type === "event") options.onEvent?.(item.event);
        else return item.message;
      }
      throw new ComintyStreamError("Le flux Cominty s'est terminé sans réponse finale.", options.lastEventId);
    },

    /** Arrête un message en cours ; renvoie le message avec status "cancelled". */
    async cancel(messageId: string): Promise<ComintyMessage> {
      return MessageSchema.parse(await (await request("POST", `/chat/messages/${encodeURIComponent(messageId)}/cancel`)).json());
    },

    /**
     * Téléverse un fichier (CV en image ou PDF) : autorisation signée, envoi direct au stockage (sans la clé),
     * puis confirmation. Renvoie l'id à passer dans fileIds.
     */
    async uploadFile(bytes: Uint8Array, filename: string, mimetype: string, signal?: AbortSignal): Promise<string> {
      const permission = (await (await request("GET", "/chat/files/upload", { query: { filename, mimetype }, signal })).json()) as {
        url?: unknown;
        fields?: Record<string, string>;
      };
      if (typeof permission.url !== "string" || !permission.fields?.key) throw new ComintyError("Cominty n'a pas fourni d'adresse de téléversement.");
      const form = new FormData();
      for (const [key, value] of Object.entries(permission.fields)) form.append(key, value);
      form.append("file", new Blob([bytes as BlobPart], { type: mimetype }), filename);
      const upload = await fetchImpl(permission.url, { method: "POST", body: form, signal });
      const etag = upload.headers.get("etag");
      if (!upload.ok || !etag) throw new ComintyError(`Le téléversement du fichier a échoué (HTTP ${upload.status}).`);
      const confirmed = (await (await request("POST", "/chat/files", { body: { etag, key: permission.fields.key }, signal })).json()) as { id?: unknown };
      if (typeof confirmed.id !== "string") throw new ComintyError("Cominty n'a pas confirmé le fichier téléversé.");
      return confirmed.id;
    },
  };
}
