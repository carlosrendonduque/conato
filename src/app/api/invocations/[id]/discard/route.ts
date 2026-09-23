import { eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db/client";
import { invocations } from "@/lib/db/schema";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(
  _req: Request,
  ctx: { params: Promise<{ id: string }> },
) {
  const { id } = await ctx.params;
  if (!z.string().uuid().safeParse(id).success) {
    return NextResponse.json({ error: "invalid_id" }, { status: 400 });
  }

  const [inv] = await db
    .select()
    .from(invocations)
    .where(eq(invocations.id, id));
  if (!inv) {
    return NextResponse.json({ error: "invocation_not_found" }, { status: 404 });
  }
  if (inv.status !== "proposed") {
    return NextResponse.json(
      { error: "invocation_already_decided", currentStatus: inv.status },
      { status: 409 },
    );
  }

  await db
    .update(invocations)
    .set({ status: "discarded", decidedAt: new Date() })
    .where(eq(invocations.id, id));

  return NextResponse.json({ invocationId: id, status: "discarded" });
}
