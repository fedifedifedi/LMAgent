// Test réel de l'agent Cominty (UN appel, max_steps limité) : vérifie les routes REST, le flux d'événements,
// les questions natives et la capacité à répondre en JSON. Ne l'exécuter qu'avec l'accord de l'utilisateur (crédits).
// Lancer : npm run cominty:smoke [-- chemin/du/journal.ndjson] [--offer offer-minimal.txt] [--resume <messageId>]
// Lit COMINTY_API_KEY, COMINTY_USER_ID, COMINTY_AGENT_ID (et COMINTY_BASE_URL) depuis l'environnement (.env.local
// chargé par Bun). La clé n'est jamais affichée.
import { readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

const MAX_STEPS = 3;
const TIMEOUT_MS = 5 * 60_000;

const { COMINTY_API_KEY: apiKey, COMINTY_USER_ID: userId, COMINTY_AGENT_ID: agentId } = process.env;
const baseUrl = (process.env.COMINTY_BASE_URL ?? "https://ds.cominty.com").replace(/\/$/, "");
const logArg = process.argv.slice(2).find((arg, i, all) => !arg.startsWith("--") && all[i - 1] !== "--resume" && all[i - 1] !== "--offer");
const logPath = logArg ?? path.join(tmpdir(), "cominty-smoke.ndjson");

for (const [name, value] of Object.entries({ COMINTY_API_KEY: apiKey, COMINTY_USER_ID: userId, COMINTY_AGENT_ID: agentId })) {
  console.log(`${name.padEnd(17)} ${value ? "présent" : "ABSENT"}`);
}
if (!apiKey || !userId || !agentId) process.exit(1);
console.log(`API : ${baseUrl} · agent : ${agentId} · max_steps : ${MAX_STEPS}\n`);

const demo = (file: string) => readFileSync(path.join(import.meta.dir, "demo", file), "utf8");
const profile = JSON.parse(demo("lea-dubois.json"));
const sourceIds = [
  ...profile.experiences.map((e: { id: string }) => e.id),
  ...profile.projects.map((p: { id: string }) => p.id),
  ...profile.education.map((e: { id: string }) => e.id),
  "profile-summary", "profile-availability", "profile-skills", "profile-languages", "candidate-answers",
];

// --offer <fichier de scripts/demo> : offre envoyée (défaut : offer.txt).
const offerFile = process.argv.includes("--offer") ? process.argv[process.argv.indexOf("--offer") + 1] : "offer.txt";

// Profil fictif (Léa Dubois) et offre de démonstration : aucune donnée réelle n'est envoyée.
// Le format JSON est décrit dans la section « LMAgent mode » des instructions de l'agent.
const message = `LMAgent
Profil validé du candidat (JSON, seule source de faits) :
${JSON.stringify(profile)}

Ids de sources autorisés : ${sourceIds.join(", ")}

Offre :
${demo(offerFile)}`;

const headers = { "x-cominty-token": apiKey, "content-type": "application/json" };
const signal = AbortSignal.timeout(TIMEOUT_MS);

async function call(method: string, route: string, body?: unknown) {
  const response = await fetch(baseUrl + route, { method, headers, body: body ? JSON.stringify(body) : undefined, signal });
  if (!response.ok) throw new Error(`${method} ${route} → ${response.status} ${(await response.text()).slice(0, 500)}`);
  return response;
}

const started = performance.now();
// --resume <messageId> : se reconnecte au flux d'un message déjà lancé, sans nouvel appel à l'agent.
const resumeId = process.argv.includes("--resume") ? process.argv[process.argv.indexOf("--resume") + 1] : undefined;
let messageId = resumeId;
if (!messageId) {
  const thread = await (await call("POST", "/chat", { message: { content: message }, options: { agent_id: agentId, user_id: userId, max_steps: MAX_STEPS } })).json();
  const assistant = [...thread.messages].reverse().find((m: { role: string }) => m.role === "assistant");
  console.log(`thread ${thread.id} · message ${assistant?.id} · statut ${assistant?.status}\n`);
  if (!assistant) throw new Error("Aucun message assistant dans la réponse de POST /chat");
  messageId = assistant.id;
} else {
  console.log(`reprise du flux du message ${messageId}\n`);
}

const keepAlive = new Set<string>();
const stream = await call("GET", `/chat/messages/${messageId}/stream`);
console.log(`flux : ${stream.headers.get("content-type")}`);
const lines: string[] = [];
let terminal: Record<string, unknown> | undefined;
const decoder = new TextDecoder();
let buffer = "";
const short = (value: unknown, n = 110) => (typeof value === "string" ? value.replace(/\s+/g, " ").slice(0, n) : "");

for await (const chunk of stream.body!) {
  buffer += decoder.decode(chunk, { stream: true });
  let newline: number;
  while ((newline = buffer.indexOf("\n")) >= 0) {
    const line = buffer.slice(0, newline).trim();
    buffer = buffer.slice(newline + 1);
    if (!line) continue;
    lines.push(line);
    let obj: Record<string, unknown>;
    try {
      obj = JSON.parse(line);
    } catch {
      console.log(`  (ligne non JSON) ${short(line)}`);
      continue;
    }
    // Lignes de maintien de connexion : JSON valide mais pas un objet (nombre, chaîne, null).
    if (!obj || typeof obj !== "object" || Array.isArray(obj)) {
      keepAlive.add(line.slice(0, 40));
      continue;
    }
    if ("correlation_id" in obj) {
      const data = (obj.data ?? {}) as Record<string, unknown>;
      const t = ((performance.now() - started) / 1000).toFixed(1).padStart(5);
      console.log(`  ${t}s ${String(obj.name).padEnd(20)} ${String(obj.status).padEnd(8)} ${short(data.name)} ${short(data.description ?? data.message)}`);
      if (obj.name === "result") console.log(`         coût : ${JSON.stringify(data.cost)}`);
    } else {
      terminal = obj;
    }
  }
}
writeFileSync(logPath, lines.join("\n") + "\n");

console.log(`\n=== Message final (${((performance.now() - started) / 1000).toFixed(1)} s) ===`);
if (!terminal) {
  console.log("Pas de message final dans le flux.");
} else {
  const content = String(terminal.content ?? "");
  console.log(`statut : ${terminal.status} · error_code : ${terminal.error_code ?? "—"} · fichiers : ${(terminal.files as unknown[] | undefined)?.length ?? 0}`);
  console.log(`questions : ${JSON.stringify(terminal.questions ?? null)}`);
  console.log(`structured_output : ${terminal.structured_output ? JSON.stringify(terminal.structured_output).slice(0, 300) : "null"}`);
  let parsed: unknown;
  try {
    parsed = JSON.parse(content.trim().replace(/^```(?:json)?\s*|\s*```$/g, ""));
  } catch {
    parsed = undefined;
  }
  console.log(`réponse en JSON valide : ${parsed ? "oui" : "non"} · début de la réponse :\n${content.slice(0, 900)}`);
}
console.log(`\nLignes de maintien ignorées : ${[...keepAlive].join(" | ") || "aucune"}`);
console.log(`Journal brut du flux : ${logPath} (${lines.length} lignes)`);
