import { describe, expect, test } from "bun:test";
import { agentSourceIds } from "@/lib/agent/agent-reply";
import { applyCorrections, parseCorrections } from "@/lib/agent/corrections";
import { repeatedTerms, type LetterIssue } from "@/lib/agent/letter-checks";
import type { LetterContent } from "@/lib/agent/schemas";
import { createMockComintyClient, mockReadyReply, type AgentClient } from "@/lib/cominty/mock-client";
import { MOCK_FIXTURES } from "@/lib/llm/fixtures";
import { cleanProfileInput } from "@/lib/profile/clean";
import { draftToFormValues, syncSkillsIntoGroups } from "@/lib/profile/form-values";
import { ProfileDraftSchema, ProfileSchema } from "@/lib/schemas/profile";
import { setupTestDatabase } from "../helpers/test-db";

await setupTestDatabase();
const { db } = await import("@/lib/db");
const { answerAgentRun, followAgentRun, startAgentRun } = await import("@/lib/letters/agent-run");
const { getLetterView } = await import("@/lib/letters/view");
const { createProfile } = await import("@/lib/repositories/profiles");

const values = syncSkillsIntoGroups(draftToFormValues(ProfileDraftSchema.parse(MOCK_FIXTURES.profile_draft))).values;
values.availability = { ...values.availability, contractTypes: ["pfe-internship"], durationMonths: 6, startDate: "2027-02" };
const profile = ProfileSchema.parse(cleanProfileInput(values));
const ids = agentSourceIds(profile);

async function newLetter() {
  const saved = await createProfile(profile);
  return db.letter.create({ data: { profileId: saved.id, offerText: "Stage de fin d'études — Développeur·se full-stack chez Ateliers Nova. React, TypeScript, Docker." } });
}

/** Enregistre les messages envoyés à l'agent. */
function recording(client: AgentClient) {
  const sent: string[] = [];
  const send = client.sendMessage.bind(client);
  client.sendMessage = async (thread, content, ...rest) => {
    sent.push(content);
    return send(thread, content, ...rest);
  };
  return sent;
}

const follow = (runId: string, client: AgentClient) => followAgentRun(runId, client, () => {});

describe("applyCorrections : les phrases de remplacement repassent par la relecture", () => {
  const letter: LetterContent = {
    language: "fr",
    subject: "Candidature",
    salutation: "Bonjour,",
    closing: "Cordialement.",
    paragraphs: [
      {
        sentences: [
          { text: "Chez Wind Consulting, j'ai mis en production une plateforme ChatOps avec StackStorm, Vault et Grafana.", sourceIds: ["a"] },
          { text: "J'ai aussi mis en production un tableau de bord.", sourceIds: ["a"] },
          { text: "Ce stage m'a appris la rigueur.", sourceIds: ["a"] },
        ],
      },
    ],
  };
  // Relecture simplifiée : « mis en production » est un statut absent du CV ; répétitions comme en vrai.
  const check = (l: LetterContent): LetterIssue[] => [
    ...l.paragraphs.flatMap((p) => p.sentences.filter((s) => s.text.includes("mis en production")).map((s) => ({ kind: "status_transferred" as const, message: "statut", sentence: s.text }))),
    ...repeatedTerms(l),
  ];
  const flagged = [letter.paragraphs[0].sentences[0].text, letter.paragraphs[0].sentences[1].text];

  test("phrase corrigée gardée ; phrase encore signalée retirée ; compensation gardée ; compensation qui répète retirée", () => {
    const applied = applyCorrections(
      letter,
      {
        status: "corrections",
        replacements: [
          { ref: "P1.S1", text: "Chez Wind Consulting, j'ai développé une plateforme ChatOps avec StackStorm, Vault et Grafana.", sourceIds: ["a"] },
          { ref: "p1.s2", text: "J'ai encore mis en production un outil.", sourceIds: ["a"] },
        ],
        additions: [
          { after: "P1.S1", text: "J'y ai intégré StackStorm, Vault et Grafana dans un même flux.", sourceIds: ["a"] },
          { after: "P1.S3", text: "J'y ai aussi rédigé la documentation.", sourceIds: ["a"] },
        ],
      },
      flagged,
      check,
    );
    expect(applied.letter.paragraphs[0].sentences.map((s) => s.text)).toEqual([
      "Chez Wind Consulting, j'ai développé une plateforme ChatOps avec StackStorm, Vault et Grafana.",
      "Ce stage m'a appris la rigueur.",
      "J'y ai aussi rédigé la documentation.",
    ]);
    expect(applied.outcomes.get(flagged[0])).toContain("j'ai développé");
    expect(applied.outcomes.get(flagged[1])).toBeNull();
    expect(applied.added).toBe(1);
  });

  test("phrase signalée que l'agent n'a pas traitée : retirée par le code", () => {
    const applied = applyCorrections(letter, { status: "corrections", replacements: [], additions: [] }, flagged, check);
    expect(applied.letter.paragraphs[0].sentences.map((s) => s.text)).toEqual(["Ce stage m'a appris la rigueur."]);
  });

  test("réponse au format « corrections » : reconnue et validée ; objet complet : null (ancien chemin)", () => {
    expect(parseCorrections('{"status":"corrections","replacements":[{"ref":"P1.S1","text":"","sourceIds":[]}]}', ["a"])).toMatchObject({ ok: true });
    expect(parseCorrections('{"status":"corrections","replacements":[{"ref":"P1.S1","text":"x","sourceIds":["inconnu"]}]}', ["a"])).toMatchObject({ ok: false });
    expect(parseCorrections('{"status":"ready"}', ["a"])).toBeNull();
  });
});

describe("pipeline : tour allégé et correction ciblée (faux agent)", () => {
  test("tour 2 allégé : sans analyse, les réponses « Oui » comptent dans les forces et les ajustements du CV", async () => {
    const client = createMockComintyClient({ delayMs: 0 });
    const sent = recording(client);
    const letter = await newLetter();
    await follow(await startAgentRun(letter.id, client), client);
    const question = (await getLetterView(letter.id))!.agent.questions![0];
    const detail = "Projet personnel : API conteneurisée avec Docker Compose";
    await follow(await answerAgentRun(letter.id, [{ prompt: question.prompt, requirement: "Docker", choice: "yes", detail }], client), client);

    expect(sent[0]).toContain('SANS la clé "analysis"');
    expect(sent[0]).toContain("« Docker »");
    expect(sent[0]).toContain("Tiens compte des réponses OUI");
    expect(sent[0]).not.toContain('"analysis":{"language"');
    const view = (await getLetterView(letter.id))!;
    expect(view.status).toBe("GENERATED");
    expect(view.analysis?.company).toBe("Ateliers Nova"); // analyse du premier tour, gardée
    expect(view.match?.requirements.find((r) => r.name === "Docker")).toMatchObject({ status: "partial", evidence: detail, sourceIds: ["candidate-answer-1"] });
    expect(view.insights?.cvAdjustments.some((c) => c.sourceIds.includes("candidate-answer-1") && c.change.includes("Docker"))).toBe(true);
  });

  test("correction ciblée : phrase encore signalée retirée sans nouveau tour, compensation sourcée gardée", async () => {
    const statut = "Chez Acme Logiciels, j'ai mis en production la refonte du tableau de bord client en React.";
    const client = createMockComintyClient({
      delayMs: 0,
      askFirst: false,
      readyReply: (allowed) => {
        const reply = mockReadyReply(allowed) as { letter: LetterContent };
        reply.letter.paragraphs[1].sentences[0].text = statut;
        return reply;
      },
      correctionReply: () => ({
        status: "corrections",
        replacements: [{ ref: "P2.S1", text: "Chez Acme Logiciels, j'ai mis en production le tableau de bord en React.", sourceIds: [ids[0]] }],
        additions: [{ after: "P2.S1", text: "Ce stage m'a appris la rigueur.", sourceIds: [ids[0]] }],
      }),
    });
    const sent = recording(client);
    const letter = await newLetter();
    await follow(await startAgentRun(letter.id, client), client);

    expect(sent).toHaveLength(1); // une seule correction, aucun troisième tour
    const view = (await getLetterView(letter.id))!;
    expect(view.status).toBe("GENERATED");
    const texts = view.letter!.paragraphs.flatMap((p) => p.sentences.map((s) => s.text));
    expect(texts.some((t) => t.includes("mis en production"))).toBe(false);
    expect(texts).toContain("Ce stage m'a appris la rigueur.");
    expect(view.review).toMatchObject({ status: "done", added: 1 });
    expect(view.review?.changes[0]).toMatchObject({ outcome: "removed", after: null });
    const label = view.agent.timeline.find((s) => s.key === "review:final")?.label;
    expect(label).toBe("Relecture : 1 affirmation sans source retirée, 1 phrase sourcée ajoutée");
  });

  test("correction ciblée au mauvais format : première lettre gardée, points signalés, aucun nouveau tour", async () => {
    const client = createMockComintyClient({
      delayMs: 0,
      askFirst: false,
      readyReply: (allowed) => {
        const reply = mockReadyReply(allowed) as { letter: LetterContent };
        reply.letter.paragraphs[1].sentences[0].text = "Chez Acme Logiciels, j'ai mis en production la refonte du tableau de bord client en React.";
        return reply;
      },
      correctionReply: () => ({ status: "corrections", replacements: [{ ref: "P2.S1", text: "x", sourceIds: ["id-inexistant"] }] }),
    });
    const sent = recording(client);
    const letter = await newLetter();
    await follow(await startAgentRun(letter.id, client), client);
    expect(sent).toHaveLength(1);
    const view = (await getLetterView(letter.id))!;
    expect(view.status).toBe("GENERATED");
    expect(view.review?.status).toBe("reported");
    expect(view.letter!.paragraphs[1].sentences[0].text).toContain("mis en production");
  });
});
