import { createHash } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db/client";
import { fileVersions, files } from "@/lib/db/schema";
import { scheduleAutoReindex } from "@/lib/rag/auto-reindex";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

interface Ctx {
  params: Promise<{ id: string; vid: string }>;
}

/**
 * Restaurar una versión histórica: copia su contenido al campo `content`
 * del archivo y crea una entrada nueva en `file_versions` con ese
 * contenido. NO pisa la versión histórica — el historial es append-only
 * por diseño. Si alguien se equivoca al restaurar, puede restaurar otra
 * vez, no hay pérdida.
 *
 * Devuelve el contenido nuevo del archivo para que el cliente actualice
 * el editor sin pedir un GET extra.
 */
export async function POST(_req: Request, ctx: Ctx) {
  const { id, vid } = await ctx.params;
  if (
    !z.string().uuid().safeParse(id).success ||
    !z.string().uuid().safeParse(vid).success
  ) {
    return NextResponse.json({ error: "invalid_id" }, { status: 400 });
  }

  const [version] = await db
    .select()
    .from(fileVersions)
    .where(and(eq(fileVersions.id, vid), eq(fileVersions.fileId, id)));
  if (!version) {
    return NextResponse.json({ error: "version_not_found" }, { status: 404 });
  }

  const [file] = await db.select().from(files).where(eq(files.id, id));
  if (!file) {
    return NextResponse.json({ error: "file_not_found" }, { status: 404 });
  }

  const restoredContent = version.content;
  const restoredHash = createHash("sha256")
    .update(restoredContent, "utf8")
    .digest("hex");

  await db.transaction(async (tx) => {
    await tx
      .update(files)
      .set({
        content: restoredContent,
        updatedAt: new Date(),
      })
      .where(eq(files.id, id));
    await tx.insert(fileVersions).values({
      fileId: id,
      parentVersionId: vid,
      content: restoredContent,
      contentHash: restoredHash,
      frontmatter: version.frontmatter,
    });
  });

  // Restaurar muta files.content; reflejarlo en GitHub para que el repo
  // refleje el estado real (la versión vieja queda accesible en el git
  // log igual, gracias al historial de commits) y reindexar chunks.
  scheduleAutoReindex(id);

  return NextResponse.json({
    content: restoredContent,
    restoredFromVersionId: vid,
  });
}
