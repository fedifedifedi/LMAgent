import { describe, expect, test } from "bun:test";
import { ProfileSummarySchema } from "@/lib/agent/schemas";
import { ComintyRateLimitError } from "@/lib/cominty/errors";
import type { ComintyEvent, ComintyMessage } from "@/lib/cominty/schemas";
import { LLMConfigError, LLMRateLimitError, LLMResponseError, LLMValidationError } from "@/lib/llm/errors";
import { generateObject } from "@/lib/llm/generate";
import { getProvider } from "@/lib/llm";
import { createComintyProvider, stripCodeFence, taskMessage, type ComintyTaskClient } from "@/lib/llm/providers/cominty";

const OUTPUT = { name: "profile_summary", schema: ProfileSummarySchema };

const message = (content: string, extra: Partial<ComintyMessage> = {}): ComintyMessage => ({
  id: "m",
  thread_id: "t",
  role: "assistant",
  content,
  status: "success",
  files: [],
  ...extra,
});

const resultEvent = (total: number): ComintyEvent => ({
  id: "e-result",
  correlation_id: 9,
  at: "2026-10-23T10:00:00Z",
  status: "success",
  name: "result",
  data: { reply: "", files: [], cost: { failed: false, input_tokens: 1000, cached_tokens: 400, output_tokens: 200, input_cost: 0, output_cost: 0, total } },
});

/** Faux client Cominty : réponses servies dans l'ordre, appels enregistrés. */
function fakeClient(replies: Array<ComintyMessage | Error>) {
  const calls: Array<{ kind: string; args: unknown[] }> = [];
  let turn = 0;
  const client: ComintyTaskClient = {
    agentId: "agent-test",
    async startChat(...args) {
      calls.push({ kind: "startChat", args });
      return { threadId: "thread-1", messageId: `msg-${++turn}` };
    },
    async sendMessage(...args) {
      calls.push({ kind: "sendMessage", args });
      return { threadId: "thread-1", messageId: `msg-${++turn}` };
    },
    async waitForMessage(messageId, options) {
      calls.push({ kind: "waitForMessage", args: [messageId] });
      const reply = replies.shift();
      if (!reply) throw new Error("plus de réponse prévue");
      if (reply instanceof Error) throw reply;
      options?.onEvent?.(resultEvent(0.05));
      return reply;
    },
    async uploadFile(...args) {
      calls.push({ kind: "uploadFile", args });
      return "file-1";
    },
  };
  return { client, calls };
}

const run = (client: ComintyTaskClient, extra: { attachments?: Parameters<typeof generateObject>[0]["attachments"] } = {}) =>
  generateObject({ output: OUTPUT, system: "Write a summary.", prompt: "Profile: {…}", provider: createComintyProvider(client), ...extra });

describe("provider cominty", () => {
  test("une tâche = un message « LMAgent task » avec consignes et schéma ; coût et tokens remontés", async () => {
    const { client, calls } = fakeClient([message('{"summary":"Étudiante en data science."}')]);
    const result = await run(client);
    expect(result.data.summary).toBe("Étudiante en data science.");
    expect(result.usage).toMatchObject({ provider: "cominty", model: "agent:agent-test", attempts: 1, inputTokens: 1000, outputTokens: 200, cacheReadTokens: 400, costUsd: 0.05 });
    const content = calls[0].args[0] as string;
    expect(content.startsWith("LMAgent task: profile_summary")).toBe(true);
    expect(content).toContain("Write a summary.");
    expect(content).toContain('"summary"');
    expect(content).toContain("Profile: {…}");
    expect(content).toContain("Ne déduis jamais ce qui n'est pas écrit");
    expect(content).toContain("Ne transfère jamais une technique");
  });

  test("relance dans la même conversation avec l'erreur de validation, sans redémarrer ni renvoyer les fichiers", async () => {
    const { client, calls } = fakeClient([message('{"résumé":"oups"}'), message('```json\n{"summary":"Corrigé."}\n```')]);
    const result = await run(client, { attachments: [{ mimeType: "image/png", data: new Uint8Array([1, 2]) }] });
    expect(result.data.summary).toBe("Corrigé.");
    expect(result.usage.attempts).toBe(2);
    expect(result.usage.costUsd).toBeCloseTo(0.1, 6);
    expect(calls.map((c) => c.kind)).toEqual(["uploadFile", "startChat", "waitForMessage", "sendMessage", "waitForMessage"]);
    expect(calls[0].args.slice(1)).toEqual(["cv-1.png", "image/png"]);
    expect(calls[1].args[1]).toEqual({ fileIds: ["file-1"] });
    expect(calls[3].args[0]).toBe("thread-1");
    expect(calls[3].args[1]).toContain("does not match the required JSON schema");
  });

  test("question de l'agent au lieu d'une réponse : erreur explicite", async () => {
    const { client } = fakeClient([message('{"status":"needs_input"}', { questions: [{ prompt: "Quel poste ?", options: [] }] })]);
    const error = await run(client).catch((e) => e);
    expect(error).toBeInstanceOf(LLMResponseError);
    expect(error.message).toContain("Quel poste ?");
  });

  test("message en échec (crédits épuisés) : erreur avec le code de Cominty", async () => {
    const { client } = fakeClient([message("", { status: "failed", error_code: "budget_exhausted" })]);
    const error = await run(client).catch((e) => e);
    expect(error).toBeInstanceOf(LLMResponseError);
    expect(error.message).toContain("budget_exhausted");
  });

  test("429 de Cominty → LLMRateLimitError du provider cominty", async () => {
    const { client } = fakeClient([new ComintyRateLimitError(429, "slow down", 20, "Limite Cominty atteinte.")]);
    const error = await run(client).catch((e) => e);
    expect(error).toBeInstanceOf(LLMRateLimitError);
    expect(error).toMatchObject({ provider: "cominty", retryAfterSeconds: 20 });
  });

  test("trois réponses invalides : LLMValidationError comme pour les autres providers", async () => {
    const { client } = fakeClient([message("pas du json"), message("{}"), message("{}")]);
    expect(run(client)).rejects.toBeInstanceOf(LLMValidationError);
  });

  test("réponse réelle : JSON dans un bloc de code suivi de notes Markdown → extrait et validé du premier coup", async () => {
    const real = '```json\n{"summary":"Étudiante en data science {Bordeaux}."}\n```\n\n**Extraction notes**\n\n| Field | Decision |\n|---|---|\n| summary | copied |';
    const { client, calls } = fakeClient([message(real)]);
    const result = await run(client);
    expect(result.data.summary).toBe("Étudiante en data science {Bordeaux}.");
    expect(calls.filter((c) => c.kind === "sendMessage")).toHaveLength(0);
    expect(stripCodeFence('Voici le profil : {"a":{"b":"}"}} et une note.')).toBe('{"a":{"b":"}"}}');
  });

  test("réponse illisible du client Cominty (ZodError) : erreur lisible", async () => {
    const zod = Object.assign(new Error("messages: expected array"), { name: "ZodError" });
    const { client } = fakeClient([zod]);
    const error = await run(client).catch((e) => e);
    expect(error).toBeInstanceOf(LLMResponseError);
    expect(error.message).toContain("Réponse inattendue de Cominty");
  });

  test("helpers : bloc de code retiré, mention du fichier joint", () => {
    expect(stripCodeFence('```json\n{"a":1}\n```')).toBe('{"a":1}');
    expect(stripCodeFence('{"a":1}')).toBe('{"a":1}');
    const text = taskMessage({ name: "profile_draft", system: "s", jsonSchema: {}, turns: [{ role: "user", text: "Extract." }] }, true);
    expect(text).toContain("the attached file is the source");
  });

  test("LLM_PROVIDER=cominty sans configuration : LLMConfigError, sans LLM_MODEL requis", () => {
    expect(() => getProvider({ LLM_PROVIDER: "cominty" })).toThrow(LLMConfigError);
    const provider = getProvider({ LLM_PROVIDER: "cominty", COMINTY_API_KEY: "k", COMINTY_USER_ID: "user_AAAAAAAAAAAAAAAAAAAAAAAA", COMINTY_AGENT_ID: "a1" });
    expect(provider).toMatchObject({ name: "cominty", model: "agent:a1" });
  });
});
