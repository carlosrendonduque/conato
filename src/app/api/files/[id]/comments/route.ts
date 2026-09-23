import { randomUUID } from "node:crypto";
import { and, asc, eq, isNull } from "drizzle-orm";
import { NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db/client";
import { comments } from "@/lib/db/schema";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

interface Ctx {
  params: Promise<{ id: string }>;
}

/**
 * Lista los comentarios del archivo. Por default solo los no resueltos —
 * un comentario "resuelto" se mantiene en DB para historia pero deja
 * de estorbar la vista activa. `?all=1` los incluye.
 */
export async function GET(req: Request, ctx: Ctx) {
  const { id } = await ctx.params;
  if (!z.string().uuid().safeParse(id).success) {
    return NextResponse.json({ error: "invalid_id" }, { status: 400 });
  }
  const url = new URL(req.url);
  const includeResolved = url.searchParams.get("all") === "1";
  const where = includeResolved
    ? eq(comments.fileId, id)
    : and(eq(comments.fileId, id), isNull(comments.resolvedAt));

  const rows = await db
    .select()
    .from(comments)
    .where(where)
    .orderBy(asc(comments.createdAt));

  return NextResponse.json({ comments: rows });
}

const createSchema = z.object({
  body: z.string().min(1).max(2000),
  anchorQuote: z.string().min(1).max(500),
  anchorPrefix: z.string().max(100).optional(),
  anchorSuffix: z.string().max(100).optional(),
});

/**
 * Crea un comentario anclado a un fragmento de texto. El cliente manda
 * el quote exacto seleccionado más prefijo/suffix de contexto para
 * desambiguar cuando el quote se repite en el archivo.
 */
export async function POST(req: Request, ctx: Ctx) {
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
  const parsed = createSchema.safeParse(raw);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "invalid_request", issues: parsed.error.flatten() },
      { status: 400 },
    );
  }

  try {
    const [created] = await db
      .insert(comments)
      .values({
        fileId: id,
        anchorMarkId: randomUUID(),
        body: parsed.data.body,
        anchorQuote: parsed.data.anchorQuote,
        anchorPrefix: parsed.data.anchorPrefix ?? "",
        anchorSuffix: parsed.data.anchorSuffix ?? "",
      })
      .returning();

    if (!created) {
      return NextResponse.json({ error: "create_failed" }, { status: 500 });
    }
    return NextResponse.json(created);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[comments POST] failed", message);
    return NextResponse.json(
      { error: "create_failed", detail: message },
      { status: 500 },
    );
  }
}
