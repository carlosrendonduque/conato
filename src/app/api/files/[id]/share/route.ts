import { eq, sql } from "drizzle-orm";
import { NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db/client";
import { files } from "@/lib/db/schema";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const bodySchema = z.object({
  share: z.boolean(),
});

/**
 * Marca o desmarca el archivo como compartible externamente vía la página
 * `/editor/<token>`. Almacena el flag dentro del frontmatter para que
 * sobreviva a renames y se exporte con el `.md` cuando hace falta.
 *
 * Mergeamos con jsonb concat (||) para preservar otros campos del
 * frontmatter (kind, title, voice, etc.) sin pisarlos.
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
  const parsed = bodySchema.safeParse(raw);
  if (!parsed.success) {
    return NextResponse.json({ error: "invalid_request" }, { status: 400 });
  }

  const patch = JSON.stringify({ share_external: parsed.data.share });

  const [updated] = await db
    .update(files)
    .set({
      frontmatter: sql`coalesce(${files.frontmatter}, '{}'::jsonb) || ${patch}::jsonb`,
      updatedAt: new Date(),
    })
    .where(eq(files.id, id))
    .returning({ id: files.id, frontmatter: files.frontmatter });

  if (!updated) {
    return NextResponse.json({ error: "file_not_found" }, { status: 404 });
  }

  return NextResponse.json({
    id: updated.id,
    share: parsed.data.share,
  });
}
