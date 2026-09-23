import { eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { db } from "@/lib/db/client";
import { files } from "@/lib/db/schema";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * Sirve el contenido del archivo como adjunto Markdown. El navegador lo
 * descarga directo en vez de mostrarlo. El nombre del archivo descargado
 * es el `path` (puede contener slashes — los navegadores los aceptan
 * como parte del filename del attachment).
 */
export async function GET(
  _req: Request,
  ctx: { params: Promise<{ id: string }> },
) {
  const { id } = await ctx.params;
  const [file] = await db.select().from(files).where(eq(files.id, id));
  if (!file) {
    return NextResponse.json({ error: "file_not_found" }, { status: 404 });
  }

  // Sanitizamos el filename para Content-Disposition: solo el último
  // segmento del path, sin caracteres problemáticos.
  const leaf = file.path.split("/").pop() ?? "archivo.md";
  const safeName = leaf.replace(/[^\w.\-]/g, "_");

  return new Response(file.content, {
    status: 200,
    headers: {
      "Content-Type": "text/markdown; charset=utf-8",
      "Content-Disposition": `attachment; filename="${safeName}"`,
      "Cache-Control": "no-store",
    },
  });
}
