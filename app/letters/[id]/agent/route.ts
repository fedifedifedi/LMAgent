import type { NextRequest } from "next/server";
import { getAgentClient } from "@/lib/cominty/agent-client";
import { db } from "@/lib/db";
import { followAgentRun, markFollowFailure, type AgentStreamEvent } from "@/lib/letters/agent-run";

/**
 * Étapes de l'agent Cominty en direct (Server-Sent Events) : rejoue les étapes enregistrées puis relaie le flux.
 * La clé reste côté serveur. Fermer la page n'arrête pas l'agent : la reprise se fait au prochain affichage.
 */
export async function GET(request: NextRequest, ctx: RouteContext<"/letters/[id]/agent">) {
  const { id } = await ctx.params;
  const runId = request.nextUrl.searchParams.get("run");
  const run = runId ? await db.agentRun.findUnique({ where: { id: runId }, select: { letterId: true } }) : null;
  if (!run || run.letterId !== id) return Response.json({ error: "Exécution introuvable." }, { status: 404 });

  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const send = (event: AgentStreamEvent) => {
        try {
          controller.enqueue(encoder.encode(`event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`));
        } catch {
          // Navigateur déjà parti : on ignore.
        }
      };
      try {
        controller.enqueue(encoder.encode(": connecté\n\n"));
        await followAgentRun(runId!, getAgentClient(), send, request.signal);
      } catch (error) {
        // Jamais d'erreur brute (Zod, Prisma) à l'écran ; la lettre devient reprenable au lieu de se relancer seule.
        send({ type: "failed", error: await markFollowFailure(id, error) });
      } finally {
        try {
          controller.close();
        } catch {
          // Déjà fermé.
        }
      }
    },
  });

  return new Response(stream, {
    headers: { "content-type": "text/event-stream; charset=utf-8", "cache-control": "no-store, no-transform", connection: "keep-alive", "x-accel-buffering": "no" },
  });
}
