import { describe, expect, test } from "bun:test";
import { agentReplySchema, agentSourceIds, parseAgentReply } from "@/lib/agent/agent-reply";
import { eventLabel } from "@/lib/agent/agent-labels";
import { ComintyStreamError } from "@/lib/cominty/errors";
import { createMockComintyClient, mockReadyReply, MOCK_QUESTION, type AgentClient } from "@/lib/cominty/mock-client";
import type { ComintyEvent, ComintyMessage } from "@/lib/cominty/schemas";
import type { StreamItem } from "@/lib/cominty/stream";
import { MOCK_FIXTURES } from "@/lib/llm/fixtures";
import { cleanProfileInput } from "@/lib/profile/clean";
import { draftToFormValues, syncSkillsIntoGroups } from "@/lib/profile/form-values";
import { ProfileDraftSchema, ProfileSchema, type Profile } from "@/lib/schemas/profile";
import { setupTestDatabase } from "../helpers/test-db";

await setupTestDatabase();
const { db } = await import("@/lib/db");
const { answerAgentRun, cancelAgentRun, followAgentRun, startAgentRun, BUDGET_MESSAGE, CANCELLED_MESSAGE } = await import("@/lib/letters/agent-run");
const { getLetterView } = await import("@/lib/letters/view");
const { createProfile } = await import("@/lib/repositories/profiles");
type AgentStreamEvent = import("@/lib/letters/agent-run").AgentStreamEvent;

// Profil de test : le brouillon de la fixture mock (Camille), cohérent avec la réponse du faux agent.
const values = syncSkillsIntoGroups(draftToFormValues(ProfileDraftSchema.parse(MOCK_FIXTURES.profile_draft))).values;
values.availability = { ...values.availability, contractTypes: ["pfe-internship"], durationMonths: 6, startDate: "2027-02" };
const profile: Profile = ProfileSchema.parse(cleanProfileInput(values));
const ids = agentSourceIds(profile);

async function newLetter() {
  const saved = await createProfile(profile);
  return db.letter.create({ data: { profileId: saved.id, offerText: "Stage de fin d'études — Développeur·se full-stack chez Ateliers Nova. React, TypeScript, Docker." } });
}

async function follow(runId: string, client: AgentClient) {
  const events: AgentStreamEvent[] = [];
  await followAgentRun(runId, client, (e) => events.push(e));
  return events;
}

const ev = (n: number, name: string, status: "running" | "success", data?: unknown) =>
  ({ id: `e${n}`, correlation_id: n, at: new Date(2026, 9, 23, 10, 0, n).toISOString(), status, name, ...(data ? { data } : {}) }) as ComintyEvent;

const COST = { failed: false, input_tokens: 1200, cached_tokens: 0, output_tokens: 800, input_cost: 0, output_cost: 0, total: 0.08 };

/** Faux client scripté : une réponse par message envoyé ; "interrupt" coupe le flux une fois après le 1er événement. */
function scriptedClient(replies: Array<Partial<ComintyMessage> | "interrupt">) {
  const sent: string[] = [];
  const resumedFrom: Array<string | undefined> = [];
  let n = 0;
  const threadId = `t-${crypto.randomUUID()}`;
  const queue = [...replies];
  const byMessage = new Map<string, Partial<ComintyMessage> | "interrupt">();
  const started = (content: string) => {
    sent.push(content);
    const messageId = `m${++n}-${crypto.randomUUID()}`;
    byMessage.set(messageId, queue.shift() ?? {});
    return { threadId, messageId };
  };
  const client: AgentClient = {
    agentId: "scripted",
    startChat: async (content) => started(content),
    sendMessage: async (_thread, content) => started(content),
    async *stream(messageId, options = {}): AsyncGenerator<StreamItem> {
      resumedFrom.push(options.lastEventId);
      let reply = byMessage.get(messageId)!;
      if (!options.lastEventId) yield { type: "event", event: ev(1, "llm", "running", { description: "Reasoning" }) };
      if (reply === "interrupt") {
        byMessage.set(messageId, { content: JSON.stringify(mockReadyReply(ids)) });
        throw new ComintyStreamError("coupure", "e1");
      }
      yield { type: "event", event: ev(2, "result", "success", { reply: "", files: [], cost: COST }) };
      reply = reply as Partial<ComintyMessage>;
      yield { type: "message", message: { id: messageId, thread_id: "t1", role: "assistant", content: "", status: "success", files: [], ...reply } };
    },
    cancel: async (messageId) => ({ id: messageId, thread_id: "t1", role: "assistant", content: "", status: "cancelled", files: [] }),
  };
  return { client, sent, resumedFrom };
}

describe("lettre par l'agent (faux agent Cominty)", () => {
  test("question native puis lettre : étapes en direct, NEEDS_INPUT, puis lettre complète avec score et sources", async () => {
    const client = createMockComintyClient({ delayMs: 0 });
    const letter = await newLetter();

    const runId = await startAgentRun(letter.id, client);
    expect(await startAgentRun(letter.id, client)).toBe(runId); // double clic : même exécution

    const first = await follow(runId, client);
    expect(first.filter((e) => e.type === "step").length).toBeGreaterThanOrEqual(4);
    expect(first.at(-1)).toEqual({ type: "questions", questions: [MOCK_QUESTION] });
    let view = (await getLetterView(letter.id))!;
    expect(view.status).toBe("NEEDS_INPUT");
    expect(view.agent.questions?.[0].prompt).toBe(MOCK_QUESTION.prompt);

    const answerRun = await answerAgentRun(letter.id, [{ prompt: MOCK_QUESTION.prompt, answer: "Les missions du poste" }], client);
    const second = await follow(answerRun, client);
    expect(second.at(-1)).toEqual({ type: "done" });

    view = (await getLetterView(letter.id))!;
    expect(view.status).toBe("GENERATED");
    expect(view.letter?.salutation).toBe("Bonjour Sarah Lemoine,");
    expect(view.analysis?.company).toBe("Ateliers Nova");
    expect(view.match?.requirements.find((r) => r.name === "Docker")?.status).toBe("missing");
    expect(view.insights?.score).toBe(78);
    expect(view.checks).toEqual([]);
    expect(view.agent.activeRunId).toBeNull();
    expect(view.usage.filter((u) => u.step === "AGENT_LETTER")).toHaveLength(2);
    expect(view.sources["candidate-answers"]).toBe("Tes réponses à l'agent");
  });

  test("rechargement : les étapes sont rejouées depuis la base, sans doublon ni nouvel appel", async () => {
    const client = createMockComintyClient({ delayMs: 0, askFirst: false });
    const letter = await newLetter();
    const runId = await startAgentRun(letter.id, client);
    const live = await follow(runId, client);
    const replay = await follow(runId, client);
    expect(replay.filter((e) => e.type === "step")).toEqual(live.filter((e) => e.type === "step"));
    expect(replay.at(-1)).toEqual({ type: "done" });
    expect(await db.agentEvent.count({ where: { runId } })).toBe(live.filter((e) => e.type === "step").length);
  });

  test("JSON invalide : une seule correction dans la même conversation, puis lettre", async () => {
    const { client, sent } = scriptedClient([{ content: '{"status":"ready","score":"beaucoup"}' }, { content: JSON.stringify(mockReadyReply(ids)) }]);
    const letter = await newLetter();
    const events = await follow(await startAgentRun(letter.id, client), client);
    expect(events.some((e) => e.type === "run")).toBe(true);
    expect(events.at(-1)).toEqual({ type: "done" });
    expect(sent[1]).toContain("ne respecte pas le format JSON attendu");
    expect(await db.agentRun.count({ where: { letterId: letter.id, kind: "CORRECTION" } })).toBe(1);
  });

  test("JSON invalide deux fois : échec reprenable, sans seconde correction", async () => {
    const { client, sent } = scriptedClient([{ content: "pas du json" }, { content: "toujours pas" }]);
    const letter = await newLetter();
    const events = await follow(await startAgentRun(letter.id, client), client);
    expect(events.at(-1)?.type).toBe("failed");
    expect(sent).toHaveLength(2);
    expect((await db.letter.findUniqueOrThrow({ where: { id: letter.id } })).status).toBe("FAILED");
  });

  test("crédits épuisés : message clair", async () => {
    const { client } = scriptedClient([{ status: "failed", error_code: "budget_exhausted" }]);
    const letter = await newLetter();
    const events = await follow(await startAgentRun(letter.id, client), client);
    expect(events.at(-1)).toEqual({ type: "failed", error: BUDGET_MESSAGE });
  });

  test("coupure du flux : exécution gardée en cours, reprise après le dernier événement", async () => {
    const { client, resumedFrom } = scriptedClient(["interrupt"]);
    const letter = await newLetter();
    const runId = await startAgentRun(letter.id, client);
    expect((await follow(runId, client)).at(-1)).toEqual({ type: "interrupted" });
    expect((await db.agentRun.findUniqueOrThrow({ where: { id: runId } })).lastEventId).toBe("e1");
    expect((await follow(runId, client)).at(-1)).toEqual({ type: "done" });
    expect(resumedFrom).toEqual([undefined, "e1"]);
  });

  test("annulation : exécution annulée, lettre reprenable", async () => {
    const client = createMockComintyClient({ delayMs: 0 });
    const letter = await newLetter();
    await startAgentRun(letter.id, client);
    await cancelAgentRun(letter.id, client);
    const view = (await getLetterView(letter.id))!;
    expect(view.status).toBe("FAILED");
    expect(view.error).toBe(CANCELLED_MESSAGE);
    expect(view.agent.activeRunId).toBeNull();
  });
});

describe("réponse de l'agent (schéma)", () => {
  test("la réponse du faux agent est valide", () => {
    expect(agentReplySchema(ids).safeParse(mockReadyReply(ids)).success).toBe(true);
  });

  test("source inconnue ou exigence absente de l'analyse : erreurs à renvoyer à l'agent", () => {
    const reply = mockReadyReply(ids) as ReturnType<typeof mockReadyReply> & { strengths: Array<{ requirement: string; sourceIds: string[] }> };
    reply.strengths[0] = { ...reply.strengths[0], requirement: "React avancé", sourceIds: ["exp-inventee"] };
    const parsed = parseAgentReply("```json\n" + JSON.stringify(reply) + "\n```", ids);
    expect(parsed.ok).toBe(false);
    if (parsed.ok) return;
    expect(parsed.issues).toContain("analysis.requirements");
    expect(parsed.issues).toContain("sourceIds");
  });

  test("libellés lisibles des événements, jamais le raisonnement brut", () => {
    expect(eventLabel(ev(1, "llm", "running", { description: "Reasoning" }))).toBe("Réflexion");
    expect(eventLabel(ev(1, "llm", "success", { description: "The user wants me to respond with a JSON object only, no Markdown. Let me analyze…" }))).toBe("Réflexion");
    expect(eventLabel(ev(1, "tool_call", "running", { name: "web_search", description: "" }))).toBe("Recherche web");
    expect(eventLabel(ev(1, "setting_up_sandbox", "running"))).toBe("Préparation de l'espace de travail");
  });
});
