import { asc, eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db/client";
import { candidates, invocations } from "@/lib/db/schema";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

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
      candidateId: candidates.id,
      invocationId: invocations.id,
      note: candidates.note,
      createdAt: candidates.createdAt,
      operation: invocations.operation,
      provider: invocations.provider,
      model: invocations.model,
      userPrompt: invocations.userPrompt,
      responseText: invocations.responseText,
    })
    .from(candidates)
    .innerJoin(invocations, eq(candidates.invocationId, invocations.id))
    .where(eq(candidates.fileId, id))
    .orderBy(asc(candidates.createdAt));

  return NextResponse.json({ candidates: rows });
}
