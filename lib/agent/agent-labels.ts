import type { ComintyEvent } from "@/lib/cominty/schemas";

/** Libellés lisibles des descriptions courtes que Cominty envoie pour les étapes de réflexion. */
const LLM_DESCRIPTIONS: Record<string, string> = {
  reasoning: "Réflexion",
  thinking: "Réflexion",
  writing: "Rédaction",
};

/** Libellé d'un outil d'après son nom (le nom exact dépend de la configuration de l'agent). */
function toolLabel(name: string, description: string): string {
  const n = name.toLowerCase();
  if (/search|web|browse/.test(n)) return "Recherche web";
  if (/read|document|pdf|ocr|file/.test(n)) return "Lecture du document";
  if (/memory/.test(n)) return "Mémoire de l'agent";
  if (/python|code|sandbox/.test(n)) return "Calcul dans le bac à sable";
  return description.trim() || `Outil ${name}`;
}

/** Libellé d'un événement du flux Cominty, affiché dans les étapes de l'agent (jamais le texte brut du modèle). */
export function eventLabel(event: ComintyEvent): string {
  switch (event.name) {
    case "waiting_for_start":
      return "Mise en route de l'agent";
    case "setting_up_sandbox":
      return "Préparation de l'espace de travail";
    case "uploading_file":
      return `Envoi de ${event.data.filename}`;
    case "llm": {
      const description = event.data.description.trim();
      const known = LLM_DESCRIPTIONS[description.toLowerCase()];
      // Une longue description est le début du raisonnement du modèle : on n'en garde pas le texte.
      return known ?? (description && description.length <= 60 ? description : "Réflexion");
    }
    case "tool_call":
      return toolLabel(event.data.name, event.data.description);
    case "intermediary_update":
      return event.data.message.length <= 80 ? event.data.message : `${event.data.message.slice(0, 77)}…`;
    case "result":
      return "Réponse de l'agent";
    case "other":
      return event.rawName.replaceAll("_", " ");
  }
}
