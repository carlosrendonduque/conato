import { and, eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db/client";
import { fileVersions } from "@/lib/db/schema";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

interface Ctx {
  params: Promise<{ id: string; vid: string }>;
}

export async function GET(_req: Request, ctx: Ctx) {
  const { id, vid } = await ctx.params;
  if (
    !z.string().uuid().safeParse(id).success ||
    !z.string().uuid().safeParse(vid).success
  ) {
    return NextResponse.json({ error: "invalid_id" }, { status: 400 });
  }

  const [v] = await db
    .select()
    .from(fileVersions)
    .where(and(eq(fileVersions.id, vid), eq(fileVersions.fileId, id)));

  if (!v) {
    return NextResponse.json({ error: "version_not_found" }, { status: 404 });
  }

  return NextResponse.json({
    id: v.id,
    fileId: v.fileId,
    content: v.content,
    contentHash: v.contentHash,
    isMilestone: v.isMilestone,
    milestoneLabel: v.milestoneLabel,
    createdAt: v.createdAt,
    parentVersionId: v.parentVersionId,
    frontmatter: v.frontmatter,
  });
}

const patchSchema = z.object({
  isMilestone: z.boolean().optional(),
  milestoneLabel: z.string().max(120).nullable().optional(),
});

/**
 * Edita los flags de milestone de una versión. Pensado para:
 * - Renombrar el label de un milestone existente.
 * - Desmarcar un milestone (volverlo a auto-save normal).
 * - Marcar a posteriori una versión histórica como milestone (raro pero
 *   útil si se quiere etiquetar algo viejo).
 */
export async function PATCH(req: Request, ctx: Ctx) {
  const { id, vid } = await ctx.params;
  if (
    !z.string().uuid().safeParse(id).success ||
    !z.string().uuid().safeParse(vid).success
  ) {
    return NextResponse.json({ error: "invalid_id" }, { status: 400 });
  }

  let raw: unknown;
  try {
    raw = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }
  const parsed = patchSchema.safeParse(raw);
  if (!parsed.success) {
    return NextResponse.json({ error: "invalid_request" }, { status: 400 });
  }

  const set: {
    isMilestone?: boolean;
    milestoneLabel?: string | null;
  } = {};
  if (parsed.data.isMilestone !== undefined)
    set.isMilestone = parsed.data.isMilestone;
  if (parsed.data.milestoneLabel !== undefined)
    set.milestoneLabel = parsed.data.milestoneLabel;
  if (Object.keys(set).length === 0) {
    return NextResponse.json({ error: "no_fields_to_update" }, { status: 400 });
  }

  const [updated] = await db
    .update(fileVersions)
    .set(set)
    .where(and(eq(fileVersions.id, vid), eq(fileVersions.fileId, id)))
    .returning({
      id: fileVersions.id,
      isMilestone: fileVersions.isMilestone,
      milestoneLabel: fileVersions.milestoneLabel,
    });

  if (!updated) {
    return NextResponse.json({ error: "version_not_found" }, { status: 404 });
  }
  return NextResponse.json(updated);
}
