import { ComintyStreamError } from "@/lib/cominty/errors";
import { EventSchema, MessageSchema, type ComintyEvent, type ComintyMessage } from "@/lib/cominty/schemas";

/** Clé de l'enveloppe envoyée quand le serveur s'arrête avant la fin du message (cf. SDK, streaming.py). */
const SHUTDOWN_KEY = "__server_is_shutting_down";

export type StreamItem = { type: "event"; event: ComintyEvent } | { type: "message"; message: ComintyMessage };

/** Lignes JSON d'un flux application/jsonl ; ignore les lignes vides ou non JSON (maintien de connexion). */
export async function* readJsonLines(body: ReadableStream<Uint8Array>): AsyncGenerator<unknown> {
  const decoder = new TextDecoder();
  let buffer = "";
  for await (const chunk of body as unknown as AsyncIterable<Uint8Array>) {
    buffer += decoder.decode(chunk, { stream: true });
    let newline: number;
    while ((newline = buffer.indexOf("\n")) >= 0) {
      const value = parseLine(buffer.slice(0, newline));
      buffer = buffer.slice(newline + 1);
      if (value !== undefined) yield value;
    }
  }
  const last = parseLine(buffer + decoder.decode());
  if (last !== undefined) yield last;
}

function parseLine(line: string): unknown {
  const trimmed = line.trim();
  if (!trimmed) return undefined;
  try {
    return JSON.parse(trimmed);
  } catch {
    return undefined;
  }
}

/**
 * Transforme les lignes du flux en événements typés, puis le message final (ligne sans correlation_id).
 * Les lignes qui ne sont pas des objets (maintien de connexion observé en réel) sont ignorées.
 * Lève ComintyStreamError si le serveur s'arrête ou si le flux finit sans message final.
 */
export async function* parseStream(lines: AsyncIterable<unknown>): AsyncGenerator<StreamItem> {
  let lastEventId: string | undefined;
  for await (const value of lines) {
    if (!value || typeof value !== "object" || Array.isArray(value)) continue;
    const obj = value as Record<string, unknown>;
    if (SHUTDOWN_KEY in obj) {
      const partial = MessageSchema.safeParse(obj.partial);
      throw new ComintyStreamError("Cominty s'est arrêté avant la fin de la réponse.", lastEventId, partial.success ? partial.data : undefined);
    }
    if ("correlation_id" in obj) {
      const event = toEvent(obj);
      if (!event) continue;
      lastEventId = event.id;
      yield { type: "event", event };
      continue;
    }
    const message = MessageSchema.safeParse(obj);
    if (message.success) {
      yield { type: "message", message: message.data };
      return;
    }
  }
  throw new ComintyStreamError("Le flux Cominty s'est terminé sans réponse finale.", lastEventId);
}

function toEvent(obj: Record<string, unknown>): ComintyEvent | undefined {
  const known = EventSchema.safeParse(obj);
  if (known.success) return known.data;
  const { id, correlation_id, at, status, name } = obj;
  if (typeof id !== "string" || typeof correlation_id !== "number" || typeof at !== "string") return undefined;
  if (status !== "running" && status !== "success" && status !== "error") return undefined;
  return { id, correlation_id, at, status, name: "other", rawName: String(name) };
}
