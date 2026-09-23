import { createHash } from "node:crypto";
import { and, desc, eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db/client";
import { fileVersions, files } from "@/lib/db/schema";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * Lista las versiones de un archivo, más recientes primero. Devuelve
 * metadata + un preview corto del contenido (no el contenido completo,
 * que para auto-saves repetidos puede pesar). El cliente carga el
 * contenido bajo demanda con `GET .../versions/:vid`.
 */
export async function GET(
  _req: Request,
  ctx: { params: Promise<{ id: string }> },
) {
  const { id } = await ctx.params;
  if (!z.string().uuid().safeParse(id).success) {
    return NextResponse.json({ error: "invalid_id" }, { status: 400 });
  }

  const rows = await db
    .select({
      id: fileVersions.id,
      contentHash: fileVersions.contentHash,
      isMilestone: fileVersions.isMilestone,
      milestoneLabel: fileVersions.milestoneLabel,
      createdAt: fileVersions.createdAt,
      parentVersionId: fileVersions.parentVersionId,
      content: fileVersions.content,
    })
    .from(fileVersions)
    .where(eq(fileVersions.fileId, id))
    .orderBy(desc(fileVersions.createdAt));

  return NextResponse.json({
    versions: rows.map((r) => ({
      id: r.id,
      contentHash: r.contentHash,
      isMilestone: r.isMilestone,
      milestoneLabel: r.milestoneLabel,
      createdAt: r.createdAt,
      parentVersionId: r.parentVersionId,
      contentLength: r.content.length,
      contentPreview: r.content.slice(0, 240),
    })),
  });
}

const publishSchema = z.object({
  label: z.string().min(1).max(120),
});

/**
 * "Publicar versión": marca la versión más reciente del archivo como
 * milestone con la etiqueta dada. Si no hay versión todavía (edge case
 * de archivo recién creado sin saves), crea una a partir del contenido
 * actual y la marca como milestone.
 *
 * Idempotente en sentido amplio: re-publicar la misma versión solo
 * actualiza el label. No crea ruido en el historial.
 */
export async function POST(
  req: Request,
  ctx: { params: Promise<{ id: string }> },
) {
  const { id } = await ctx.params;
  if (!z.string().uuid().safeParse(id).success) {
    return NextResponse.json({ error: "invalid_id" }, { status: 400 });
  }

  let raw: unknown;
  try {
    raw = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }
  const parsed = publishSchema.safeParse(raw);
  if (!parsed.success) {
    return NextResponse.json({ error: "invalid_request" }, { status: 400 });
  }

  const [file] = await db.select().from(files).where(eq(files.id, id));
  if (!file) {
    return NextResponse.json({ error: "file_not_found" }, { status: 404 });
  }

  const [latest] = await db
    .select()
    .from(fileVersions)
    .where(eq(fileVersions.fileId, id))
    .orderBy(desc(fileVersions.createdAt))
    .limit(1);

  let target: typeof fileVersions.$inferSelect | undefined = latest;
  if (!target) {
    // No hay versiones: crear una a partir del contenido actual.
    const hash = createHash("sha256")
      .update(file.content, "utf8")
      .digest("hex");
    const [created] = await db
      .insert(fileVersions)
      .values({
        fileId: id,
        content: file.content,
        contentHash: hash,
        frontmatter: file.frontmatter,
      })
      .returning();
    target = created;
  }

  if (!target) {
    return NextResponse.json(
      { error: "could_not_create_milestone_version" },
      { status: 500 },
    );
  }

  const [updated] = await db
    .update(fileVersions)
    .set({
      isMilestone: true,
      milestoneLabel: parsed.data.label,
    })
    .where(
      and(
        eq(fileVersions.id, target.id),
        eq(fileVersions.fileId, id),
      ),
    )
    .returning({
      id: fileVersions.id,
      isMilestone: fileVersions.isMilestone,
      milestoneLabel: fileVersions.milestoneLabel,
      createdAt: fileVersions.createdAt,
    });

  return NextResponse.json({
    versionId: updated?.id,
    isMilestone: updated?.isMilestone,
    milestoneLabel: updated?.milestoneLabel,
    createdAt: updated?.createdAt,
  });
}
