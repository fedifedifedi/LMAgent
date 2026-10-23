import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import path from "node:path";
import { createComintyClient } from "@/lib/cominty/client";
import { readComintyConfig, type ComintyConfig } from "@/lib/cominty/config";
import { ComintyAuthError, ComintyConfigError, ComintyError, ComintyRateLimitError, ComintyStreamError } from "@/lib/cominty/errors";
import { parseStream, readJsonLines, type StreamItem } from "@/lib/cominty/stream";

// Flux réels enregistrés par npm run cominty:smoke (profil fictif de Léa Dubois).
const fixture = (name: string) => readFileSync(path.join(import.meta.dir, "..", "fixtures", "cominty", name), "utf8");

const CONFIG: ComintyConfig = { apiKey: "test-key-secret", userId: "user_AAAAAAAAAAAAAAAAAAAAAAAA", agentId: "agent-test", baseUrl: "https://cominty.test" };

/** Corps de réponse découpé en morceaux arbitraires, pour vérifier le recollage des lignes. */
function bodyOf(text: string, chunkSize = 37): ReadableStream<Uint8Array> {
  const bytes = new TextEncoder().encode(text);
  return new ReadableStream({
    start(controller) {
      for (let i = 0; i < bytes.length; i += chunkSize) controller.enqueue(bytes.slice(i, i + chunkSize));
      controller.close();
    },
  });
}

async function collect(text: string, chunkSize?: number): Promise<StreamItem[]> {
  const items: StreamItem[] = [];
  for await (const item of parseStream(readJsonLines(bodyOf(text, chunkSize)))) items.push(item);
  return items;
}

type Call = { url: string; method: string; headers: Record<string, string>; body?: unknown };

/** Faux fetch : enregistre chaque requête et répond avec la fonction fournie. */
function fakeFetch(respond: (call: Call) => Response) {
  const calls: Call[] = [];
  const impl = (async (input: string | URL | Request, init?: RequestInit) => {
    const headers = Object.fromEntries(new Headers(init?.headers).entries());
    const body = typeof init?.body === "string" ? JSON.parse(init.body) : init?.body;
    const call = { url: String(input), method: init?.method ?? "GET", headers, body };
    calls.push(call);
    return respond(call);
  }) as typeof fetch;
  return { impl, calls };
}

const json = (value: unknown, init: ResponseInit = {}) => new Response(JSON.stringify(value), { status: 200, headers: { "content-type": "application/json" }, ...init });

const THREAD = {
  id: "thread-1",
  messages: [
    { id: "msg-user", thread_id: "thread-1", role: "user", content: "LMAgent…", status: "success", files: [] },
    { id: "msg-assistant", thread_id: "thread-1", role: "assistant", content: "", status: "pending", files: [] },
  ],
};

describe("readComintyConfig", () => {
  test("lit la configuration et retire la barre finale de l'URL", () => {
    const config = readComintyConfig({ COMINTY_API_KEY: "k", COMINTY_USER_ID: CONFIG.userId, COMINTY_AGENT_ID: "a", COMINTY_BASE_URL: "https://x.test/" });
    expect(config).toEqual({ apiKey: "k", userId: CONFIG.userId, agentId: "a", baseUrl: "https://x.test" });
    expect(readComintyConfig({ COMINTY_API_KEY: "k", COMINTY_USER_ID: CONFIG.userId, COMINTY_AGENT_ID: "a" }).baseUrl).toBe("https://ds.cominty.com");
  });

  test("signale les variables manquantes ou mal formées sans afficher les valeurs", () => {
    expect(() => readComintyConfig({})).toThrow(ComintyConfigError);
    try {
      readComintyConfig({ COMINTY_API_KEY: "secret-123", COMINTY_USER_ID: "pas-un-id", COMINTY_AGENT_ID: "a" });
      throw new Error("aurait dû échouer");
    } catch (error) {
      expect(error).toBeInstanceOf(ComintyConfigError);
      expect((error as Error).message).toContain("COMINTY_USER_ID");
      expect((error as Error).message).not.toContain("secret-123");
      expect((error as Error).message).not.toContain("pas-un-id");
    }
  });
});

describe("parseStream (flux enregistrés)", () => {
  test("lettre prête : événements, coût, puis message final en JSON", async () => {
    const items = await collect(fixture("letter-ready.jsonl"));
    const events = items.flatMap((item) => (item.type === "event" ? [item.event] : []));
    expect(events.map((e) => e.name)).toContain("llm");
    const result = events.find((e) => e.name === "result");
    expect(result && result.name === "result" && result.data.cost.total).toBeCloseTo(0.12323775, 6);

    const last = items.at(-1)!;
    expect(last.type).toBe("message");
    if (last.type !== "message") return;
    expect(last.message.status).toBe("success");
    expect(last.message.questions ?? []).toEqual([]);
    expect(JSON.parse(last.message.content).status).toBe("ready");
  });

  test("information manquante : questions natives et status needs_input", async () => {
    const last = (await collect(fixture("needs-input.jsonl"), 11)).at(-1)!;
    if (last.type !== "message") throw new Error("message final attendu");
    expect(JSON.parse(last.message.content)).toEqual({ status: "needs_input" });
    expect(last.message.questions).toHaveLength(1);
    expect(last.message.questions![0].options.length).toBeGreaterThanOrEqual(2);
  });

  test("ignore les lignes de maintien (vides, nombres, chaînes, non JSON) et les événements inconnus restent lisibles", async () => {
    const event = { id: "e1", correlation_id: 1, at: "2026-10-23T10:00:00Z", status: "running", name: "nouvel_evenement", data: {} };
    const message = { id: "m", thread_id: "t", role: "assistant", content: "ok", status: "success", files: [] };
    const items = await collect(["", "1", '"ping"', "null", "pas du json", JSON.stringify(event), JSON.stringify(message), ""].join("\n"), 5);
    expect(items).toHaveLength(2);
    expect(items[0]).toMatchObject({ type: "event", event: { name: "other", rawName: "nouvel_evenement" } });
    expect(items[1]).toMatchObject({ type: "message", message: { content: "ok" } });
  });

  test("arrêt du serveur : erreur reprenable avec le dernier id d'événement et le message partiel", async () => {
    const event = { id: "e7", correlation_id: 1, at: "2026-10-23T10:00:00Z", status: "running", name: "llm", data: { description: "Reasoning" } };
    const partial = { id: "m", thread_id: "t", role: "assistant", content: "", status: "running", files: [] };
    const text = [JSON.stringify(event), JSON.stringify({ __server_is_shutting_down: true, partial })].join("\n");
    const error = await collect(text).catch((e) => e);
    expect(error).toBeInstanceOf(ComintyStreamError);
    expect(error.lastEventId).toBe("e7");
    expect(error.partial?.status).toBe("running");
  });

  test("flux terminé sans message final : erreur", async () => {
    expect(collect("")).rejects.toBeInstanceOf(ComintyStreamError);
  });
});

describe("createComintyClient", () => {
  test("startChat : POST /chat avec agent, utilisateur et max_steps, renvoie le message assistant", async () => {
    const { impl, calls } = fakeFetch(() => json(THREAD));
    const client = createComintyClient(CONFIG, impl);
    expect(await client.startChat("Bonjour", { fileIds: ["f1"] })).toEqual({ threadId: "thread-1", messageId: "msg-assistant" });
    expect(calls[0]).toMatchObject({ url: "https://cominty.test/chat", method: "POST" });
    expect(calls[0].headers["x-cominty-token"]).toBe(CONFIG.apiKey);
    expect(calls[0].body).toEqual({
      message: { content: "Bonjour", file_ids: ["f1"] },
      options: { agent_id: "agent-test", user_id: CONFIG.userId, max_steps: 3 },
    });
  });

  test("sendMessage : POST /chat/{thread}, max_steps personnalisé", async () => {
    const { impl, calls } = fakeFetch(() => json(THREAD));
    await createComintyClient(CONFIG, impl).sendMessage("thread-1", "Leur expertise", { maxSteps: 2 });
    expect(calls[0].url).toBe("https://cominty.test/chat/thread-1");
    expect((calls[0].body as { options: { max_steps: number } }).options.max_steps).toBe(2);
  });

  test("refuse un max_steps invalide ou plus de 5 fichiers avant tout appel", async () => {
    const { impl, calls } = fakeFetch(() => json(THREAD));
    const client = createComintyClient(CONFIG, impl);
    expect(client.startChat("x", { maxSteps: 0 })).rejects.toBeInstanceOf(ComintyError);
    expect(client.startChat("x", { fileIds: ["1", "2", "3", "4", "5", "6"] })).rejects.toBeInstanceOf(ComintyError);
    expect(calls).toHaveLength(0);
  });

  test("waitForMessage : transmet les événements et la reprise envoie last-event-id", async () => {
    const { impl, calls } = fakeFetch(() => new Response(bodyOf(fixture("needs-input.jsonl")), { headers: { "content-type": "application/jsonl" } }));
    const seen: string[] = [];
    const message = await createComintyClient(CONFIG, impl).waitForMessage("msg-assistant", { lastEventId: "e3", onEvent: (e) => seen.push(e.name) });
    expect(calls[0].url).toBe("https://cominty.test/chat/messages/msg-assistant/stream");
    expect(calls[0].headers["last-event-id"]).toBe("e3");
    expect(seen).toContain("result");
    expect(message.questions).toHaveLength(1);
  });

  test("401 : erreur d'accès, sans la clé dans le message", async () => {
    const { impl } = fakeFetch(() => json({ detail: "invalid token" }, { status: 401 }));
    const error = await createComintyClient(CONFIG, impl).startChat("x").catch((e) => e);
    expect(error).toBeInstanceOf(ComintyAuthError);
    expect(error.message).toContain("invalid token");
    expect(error.message).not.toContain(CONFIG.apiKey);
  });

  test("429 : limite atteinte avec le délai conseillé", async () => {
    const { impl } = fakeFetch(() => json({ detail: "credits exhausted" }, { status: 429, headers: { "retry-after": "30" } }));
    const error = await createComintyClient(CONFIG, impl).startChat("x").catch((e) => e);
    expect(error).toBeInstanceOf(ComintyRateLimitError);
    expect(error.retryAfterSeconds).toBe(30);
  });

  test("uploadFile : autorisation, envoi au stockage SANS la clé, confirmation", async () => {
    const { impl, calls } = fakeFetch((call) => {
      if (call.url.startsWith("https://cominty.test/chat/files/upload")) return json({ url: "https://storage.test/bucket", fields: { key: "uploads/cv.pdf", policy: "p" } });
      if (call.url === "https://storage.test/bucket") return new Response(null, { status: 204, headers: { etag: '"abc"' } });
      return json({ id: "file-1" });
    });
    const id = await createComintyClient(CONFIG, impl).uploadFile(new Uint8Array([37, 80, 68, 70]), "cv.pdf", "application/pdf");
    expect(id).toBe("file-1");
    expect(calls.map((c) => `${c.method} ${c.url.split("?")[0]}`)).toEqual([
      "GET https://cominty.test/chat/files/upload",
      "POST https://storage.test/bucket",
      "POST https://cominty.test/chat/files",
    ]);
    expect(new URL(calls[0].url).searchParams.get("mimetype")).toBe("application/pdf");
    expect(calls[1].headers["x-cominty-token"]).toBeUndefined();
    expect(calls[2].body).toEqual({ etag: '"abc"', key: "uploads/cv.pdf" });
  });
});
