import { eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db/client";
import { candidates, invocations } from "@/lib/db/schema";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const bodySchema = z.object({ note: z.string().optional() });

export async function POST(
  req: Request,
  ctx: { params: Promise<{ id: string }> },
) {
  const { id } = await ctx.params;
  if (!z.string().uuid().safeParse(id).success) {
    return NextResponse.json({ error: "invalid_id" }, { status: 400 });
  }

  let raw: unknown = {};
  try {
    const text = await req.text();
    if (text.trim() !== "") raw = JSON.parse(text);
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }
  const parsed = bodySchema.safeParse(raw);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "invalid_request", issues: parsed.error.flatten() },
      { status: 400 },
    );
  }

  const result = await db.transaction(async (tx) => {
    const [inv] = await tx
      .select()
      .from(invocations)
      .where(eq(invocations.id, id));
    if (!inv) {
      return {
        kind: "err" as const,
        status: 404,
        error: "invocation_not_found",
      };
    }
    if (inv.status !== "proposed") {
      return {
        kind: "err" as const,
        status: 409,
        error: "invocation_already_decided",
        currentStatus: inv.status,
      };
    }

    await tx
      .update(invocations)
      .set({ status: "saved", decidedAt: new Date() })
      .where(eq(invocations.id, id));

    const [cand] = await tx
      .insert(candidates)
      .values({
        invocationId: id,
        fileId: inv.fileId,
        ...(parsed.data.note !== undefined && { note: parsed.data.note }),
      })
      .returning();
    if (!cand) throw new Error("failed to insert candidate");

    return { kind: "ok" as const, candidateId: cand.id };
  });

  if (result.kind === "err") {
    const body: Record<string, unknown> = { error: result.error };
    if ("currentStatus" in result) body.currentStatus = result.currentStatus;
    return NextResponse.json(body, { status: result.status });
  }
  return NextResponse.json({
    invocationId: id,
    candidateId: result.candidateId,
    status: "saved",
  });
}
