import { eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db/client";
import { comments } from "@/lib/db/schema";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

interface Ctx {
  params: Promise<{ id: string }>;
}

const patchSchema = z.object({
  body: z.string().min(1).max(2000).optional(),
  resolved: z.boolean().optional(),
});

export async function PATCH(req: Request, ctx: Ctx) {
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
  const parsed = patchSchema.safeParse(raw);
  if (!parsed.success) {
    return NextResponse.json({ error: "invalid_request" }, { status: 400 });
  }

  const set: { body?: string; resolvedAt?: Date | null; updatedAt?: Date } = {};
  if (parsed.data.body !== undefined) set.body = parsed.data.body;
  if (parsed.data.resolved !== undefined) {
    set.resolvedAt = parsed.data.resolved ? new Date() : null;
  }
  if (Object.keys(set).length === 0) {
    return NextResponse.json({ error: "no_fields" }, { status: 400 });
  }
  set.updatedAt = new Date();

  const [updated] = await db
    .update(comments)
    .set(set)
    .where(eq(comments.id, id))
    .returning();
  if (!updated) {
    return NextResponse.json({ error: "comment_not_found" }, { status: 404 });
  }
  return NextResponse.json(updated);
}

export async function DELETE(_req: Request, ctx: Ctx) {
  const { id } = await ctx.params;
  if (!z.string().uuid().safeParse(id).success) {
    return NextResponse.json({ error: "invalid_id" }, { status: 400 });
  }
  const [deleted] = await db
    .delete(comments)
    .where(eq(comments.id, id))
    .returning({ id: comments.id });
  if (!deleted) {
    return NextResponse.json({ error: "comment_not_found" }, { status: 404 });
  }
  return NextResponse.json({ deleted: true });
}
