import { describe, expect, test } from "bun:test";
import { agentSourceIds, parseAgentReply } from "@/lib/agent/agent-reply";
import type { ComintyClient } from "@/lib/cominty/client";
import type { ComintyEvent, ComintyMessage } from "@/lib/cominty/schemas";
import type { StreamItem } from "@/lib/cominty/stream";
import { DEMO_PROFILE, DEMO_PROFILE_NAME, DEMO_OFFER } from "@/lib/demo";
import { ProfileSchema } from "@/lib/schemas/profile";
import { setupTestDatabase } from "../helpers/test-db";

await setupTestDatabase();
const { db } = await import("@/lib/db");
const guard = await import("@/lib/cominty/guard");
const { clientForMessage, clientForStart } = await import("@/lib/cominty/agent-client");
const { createReplayClient, RECORDED_RUN, REPLAY_AGENT_ID } = await import("@/lib/cominty/replay-client");
const { followAgentRun, startAgentRun } = await import("@/lib/letters/agent-run");
const { getLetterView } = await import("@/lib/letters/view");
const { createProfile } = await import("@/lib/repositories/profiles");

const result = (cost: number): ComintyEvent => ({
  id: "0-0",
  correlation_id: 1,
  at: "2026-10-23T10:00:00Z",
  status: "success",
  name: "result",
  data: { reply: "", files: [], cost: { failed: false, input_tokens: 100, cached_tokens: 0, output_tokens: 50, input_cost: 0, output_cost: 0, total: cost } },
});

/** Faux client Cominty « réel » : chaque message coûte `cost` $. */
function paidClient(cost: number) {
  let started = 0;
  const client = {
    agentId: "agent-test",
    startChat: async () => ({ threadId: "t", messageId: `paid-${++started}-${crypto.randomUUID()}` }),
    sendMessage: async () => ({ threadId: "t", messageId: `paid-${++started}-${crypto.randomUUID()}` }),
    async *stream(messageId: string): AsyncGenerator<StreamItem> {
      yield { type: "event", event: result(cost) };
      yield { type: "message", message: { id: messageId, thread_id: "t", role: "assistant", content: "{}", status: "success", files: [] } as ComintyMessage };
    },
    cancel: async () => ({}) as ComintyMessage,
    uploadFile: async () => "file",
    waitForMessage: async () => ({}) as ComintyMessage,
  } as unknown as ComintyClient;
  return { client, started: () => started };
}

describe("code d'accès", () => {
  test("exigé dès qu'il est défini, et toujours en production", () => {
    expect(guard.accessRequired({})).toBe(false);
    expect(guard.accessRequired({ DEMO_ACCESS_CODE: "secret" })).toBe(true);
    expect(guard.accessRequired({ NODE_ENV: "production" })).toBe(true);
  });

  test("le cookie porte l'empreinte du code ; mauvais code, cookie absent ou production sans code : refus", () => {
    const env = { DEMO_ACCESS_CODE: "secret" };
    expect(guard.cookieGrantsAccess(guard.hashAccessCode("secret"), env)).toBe(true);
    expect(guard.cookieGrantsAccess(guard.hashAccessCode("autre"), env)).toBe(false);
    expect(guard.cookieGrantsAccess(undefined, env)).toBe(false);
    expect(guard.cookieGrantsAccess("secret", env)).toBe(false); // jamais le code en clair
    expect(guard.cookieGrantsAccess(guard.hashAccessCode("x"), { NODE_ENV: "production" })).toBe(false);
    expect(guard.cookieGrantsAccess(undefined, {})).toBe(true); // développement local sans code
  });

  test("choix du client : mock hors cominty, rejeu pour la démo sans code, refus sinon, vrai client avec le code", () => {
    expect(clientForStart({ access: false, demo: false }, { LLM_PROVIDER: "mock" }).agentId).toBe("mock-agent");
    expect(clientForStart({ access: false, demo: true }, { LLM_PROVIDER: "cominty" }).agentId).toBe(REPLAY_AGENT_ID);
    expect(() => clientForStart({ access: false, demo: false }, { LLM_PROVIDER: "cominty" })).toThrow(guard.ComintyGuardError);
    const env = { LLM_PROVIDER: "cominty", COMINTY_API_KEY: "k", COMINTY_USER_ID: "user_AAAAAAAAAAAAAAAAAAAAAAAA", COMINTY_AGENT_ID: "a1" };
    expect(clientForStart({ access: true, demo: false }, env).agentId).toBe("a1");
    expect(clientForMessage("replay-123", env).agentId).toBe(REPLAY_AGENT_ID);
    expect(clientForMessage("mock-msg-1", env).agentId).toBe("mock-agent");
    expect(clientForMessage("8d1f…", env).agentId).toBe("a1");
  });
});

describe("plafond de dépense", () => {
  test("3 $ par défaut, valeur invalide ignorée", () => {
    expect(guard.budgetUsd({})).toBe(3);
    expect(guard.budgetUsd({ COMINTY_BUDGET_USD: "0.5" })).toBe(0.5);
    expect(guard.budgetUsd({ COMINTY_BUDGET_USD: "beaucoup" })).toBe(3);
  });

  test("chaque réponse facturée est comptée une fois ; une fois le plafond atteint, plus aucun appel", async () => {
    await db.comintyCharge.deleteMany();
    const env = { COMINTY_BUDGET_USD: "1" };
    const { client, started } = paidClient(0.6);
    const guarded = guard.guardedClient(client, env);
    const first = await guarded.startChat("x");
    await guarded.waitForMessage(first.messageId);
    await guarded.waitForMessage(first.messageId); // relecture du même flux : pas de double comptage
    expect(await guard.spentUsd()).toBeCloseTo(0.6, 6);
    const second = await guarded.startChat("y");
    await guarded.waitForMessage(second.messageId);
    expect(await guard.spentUsd()).toBeCloseTo(1.2, 6);
    const error = await guarded.startChat("z").catch((e) => e);
    expect(error).toBeInstanceOf(guard.ComintyGuardError);
    expect(error.reason).toBe("budget");
    expect(error.message).toContain("Plafond de dépense Cominty atteint");
    expect(started()).toBe(2); // le 3e appel n'est jamais parti
    await expect(guarded.sendMessage("t", "suite")).rejects.toBeInstanceOf(guard.ComintyGuardError);
    await db.comintyCharge.deleteMany();
  });
});

describe("démo sans code : rejeu d'un vrai run enregistré", () => {
  test("la réponse enregistrée est valide pour le profil de démo", () => {
    const ids = agentSourceIds(ProfileSchema.parse(DEMO_PROFILE));
    expect(parseAgentReply(JSON.stringify(RECORDED_RUN.reply), ids).ok).toBe(true);
  });

  test("même flux que l'agent (étapes, lettre, score), sans coût ni appel", async () => {
    const saved = await createProfile(DEMO_PROFILE, DEMO_PROFILE_NAME);
    const letter = await db.letter.create({ data: { profileId: saved.id, offerText: DEMO_OFFER } });
    const client = createReplayClient({ compress: false });
    const events: string[] = [];
    await followAgentRun(await startAgentRun(letter.id, client), client, (e) => events.push(e.type));
    expect(events.at(-1)).toBe("done");
    const view = (await getLetterView(letter.id))!;
    expect(view.status).toBe("GENERATED");
    expect(view.agent.replay).toBe(true);
    expect(view.agent.timeline.every((s) => s.status === "success")).toBe(true);
    expect(view.insights?.score).toBe(RECORDED_RUN.reply.score);
    expect(view.letter?.salutation).toBe(RECORDED_RUN.reply.letter.salutation);
    expect(view.usage.find((u) => u.step === "AGENT_LETTER")).toMatchObject({ costUsd: null });
    expect(await db.comintyCharge.count()).toBe(0);
  });
});
