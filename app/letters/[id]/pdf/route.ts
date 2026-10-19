import type { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { isLetterTemplate, minScale, DEFAULT_TEMPLATE, LETTER_TEMPLATES } from "@/lib/letters/templates";
import { pdfFileName } from "@/lib/letters/file-name";
import { PdfError, renderPdf } from "@/lib/pdf/render";

/** Export PDF de la lettre (puppeteer-core + Edge) ; en-têtes x-letter-* pour l'avertissement de débordement. */
export async function GET(request: NextRequest, ctx: RouteContext<"/letters/[id]/pdf">) {
  const { id } = await ctx.params;
  const letter = await db.letter.findUnique({ where: { id }, select: { content: true, analysis: true, template: true } });
  if (!letter?.content) return Response.json({ error: "La lettre n'est pas encore générée." }, { status: 404 });

  const template = isLetterTemplate(letter.template) ? letter.template : DEFAULT_TEMPLATE;
  const analysis = letter.analysis as { jobTitle?: string; company?: string } | null;
  try {
    const { pdf, scale, overflow } = await renderPdf(new URL(`/letters/${id}/print`, request.nextUrl.origin).toString(), minScale(template));
    const name = pdfFileName(analysis?.jobTitle, analysis?.company);
    return new Response(Buffer.from(pdf), {
      headers: {
        "content-type": "application/pdf",
        "content-disposition": `attachment; filename="${name.replace(/[^\x20-\x7e]/g, "_")}"; filename*=UTF-8''${encodeURIComponent(name)}`,
        "cache-control": "no-store",
        "x-letter-file-name": encodeURIComponent(name),
        "x-letter-overflow": overflow ? "1" : "0",
        "x-letter-font-pt": (LETTER_TEMPLATES[template].basePt * scale).toFixed(1),
      },
    });
  } catch (error) {
    if (error instanceof PdfError) return Response.json({ error: error.message }, { status: 500 });
    console.error("Export PDF :", error);
    return Response.json({ error: "L'export PDF a échoué. Réessaie." }, { status: 500 });
  }
}
