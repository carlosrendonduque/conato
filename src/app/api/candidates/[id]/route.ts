import { eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db/client";
import { candidates } from "@/lib/db/schema";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function DELETE(
  _req: Request,
  ctx: { params: Promise<{ id: string }> },
) {
  const { id } = await ctx.params;
  if (!z.string().uuid().safeParse(id).success) {
    return NextResponse.json({ error: "invalid_id" }, { status: 400 });
  }
  const removed = await db
    .delete(candidates)
    .where(eq(candidates.id, id))
    .returning();
  if (removed.length === 0) {
    return NextResponse.json(
      { error: "candidate_not_found" },
      { status: 404 },
    );
  }
  return NextResponse.json({ candidateId: id, deleted: true });
}
