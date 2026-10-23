// Sessions Cominty encore en cours (lecture seule) et annulation d'un message bloqué. Aucun tour d'agent, aucun crédit.
// Lister  : npm run cominty:sessions
// Annuler : npm run cominty:sessions -- --cancel <messageId>
import { createComintyClient } from "@/lib/cominty/client";
import { readComintyConfig } from "@/lib/cominty/config";

const config = readComintyConfig();
const headers = { "x-cominty-token": config.apiKey };
const cancelId = process.argv.includes("--cancel") ? process.argv[process.argv.indexOf("--cancel") + 1] : undefined;

if (cancelId) {
  const message = await createComintyClient(config).cancel(cancelId);
  console.log(`Message ${cancelId} : statut ${message.status}.`);
  process.exit(0);
}

type Message = { id: string; role: string; status: string; content?: string };
const threads = (await (await fetch(`${config.baseUrl}/chat?user_id=${config.userId}&limit=30`, { headers })).json()) as Array<{ id: string; name?: string; created_at?: string }>;
let stuck = 0;
for (const thread of threads) {
  const full = (await (await fetch(`${config.baseUrl}/chat/${thread.id}?user_id=${config.userId}`, { headers })).json()) as { messages?: Message[] };
  for (const message of (full.messages ?? []).filter((m) => m.role === "assistant" && (m.status === "pending" || m.status === "running"))) {
    stuck++;
    console.log(`${thread.created_at ?? ""} · « ${thread.name ?? "sans nom"} » · message ${message.id} · ${message.status}`);
  }
}
console.log(stuck ? `\n${stuck} message(s) en cours. Annuler : npm run cominty:sessions -- --cancel <messageId>` : "Aucun message en cours.");
