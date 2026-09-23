import { createHash } from "node:crypto";
import { desc, eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { z } from "zod";
import {
  joinFrontmatter,
  splitFrontmatter,
} from "@/lib/corpus/frontmatter";
import { db } from "@/lib/db/client";
import { fileVersions, files, invocations } from "@/lib/db/schema";
import { scheduleAutoReindex } from "@/lib/rag/auto-reindex";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

function hashContent(content: string): string {
  return createHash("sha256").update(content, "utf8").digest("hex");
}

const rangeShape = z.object({
  from: z.number().int().nonnegative(),
  to: z.number().int().nonnegative(),
});

/**
 * Aplica el texto propuesto al contenido base, según la operación:
 *  - `continue`: inserta en la posición del cursor (rango de longitud cero).
 *  - resto con selección: reemplaza el slice [from, to).
 *  - sin ubicación: error (no podemos saber dónde aplicar).
 */
function applyProposal(args: {
  baseContent: string;
  responseText: string;
  operation: string;
  selectionRange: { from: number; to: number } | null;
}): string {
  const { baseContent, responseText, operation, selectionRange } = args;
  if (selectionRange === null) {
    throw new Error("invocation has no location to apply");
  }
  if (operation === "continue") {
    const pos = selectionRange.from;
    return baseContent.slice(0, pos) + responseText + baseContent.slice(pos);
  }
  return (
    baseContent.slice(0, selectionRange.from) +
    responseText +
    baseContent.slice(selectionRange.to)
  );
}

export async function POST(
  _req: Request,
  ctx: { params: Promise<{ id: string }> },
) {
  const { id } = await ctx.params;
  if (!z.string().uuid().safeParse(id).success) {
    return NextResponse.json({ error: "invalid_id" }, { status: 400 });
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

    const [file] = await tx.select().from(files).where(eq(files.id, inv.fileId));
    if (!file) {
      return { kind: "err" as const, status: 404, error: "file_not_found" };
    }

    const rangeParsed = rangeShape.safeParse(inv.selectionRange);
    // Los offsets vienen del editor, que trabaja sobre el cuerpo sin
    // frontmatter. Aplicamos ahí y volvemos a pegar el bloque intacto.
    const { frontmatter, body } = splitFrontmatter(file.content);
    let newContent: string;
    try {
      newContent = joinFrontmatter(
        frontmatter,
        applyProposal({
          baseContent: body,
          responseText: inv.responseText,
          operation: inv.operation,
          selectionRange: rangeParsed.success ? rangeParsed.data : null,
        }),
      );
    } catch (e) {
      return {
        kind: "err" as const,
        status: 422,
        error: "could_not_apply",
        detail: (e as Error).message,
      };
    }

    const [latest] = await tx
      .select()
      .from(fileVersions)
      .where(eq(fileVersions.fileId, file.id))
      .orderBy(desc(fileVersions.createdAt))
      .limit(1);

    const [version] = await tx
      .insert(fileVersions)
      .values({
        fileId: file.id,
        parentVersionId: latest ? latest.id : null,
        content: newContent,
        contentHash: hashContent(newContent),
        frontmatter: file.frontmatter,
      })
      .returning();
    if (!version) throw new Error("failed to insert file_version");

    await tx.update(files).set({ content: newContent }).where(eq(files.id, file.id));
    await tx
      .update(invocations)
      .set({ status: "accepted", decidedAt: new Date() })
      .where(eq(invocations.id, inv.id));

    return {
      kind: "ok" as const,
      versionId: version.id,
      content: newContent,
      fileId: file.id,
    };
  });

  if (result.kind === "err") {
    const body: Record<string, unknown> = { error: result.error };
    if ("currentStatus" in result) body.currentStatus = result.currentStatus;
    if ("detail" in result) body.detail = result.detail;
    return NextResponse.json(body, { status: result.status });
  }
  // Aceptar una propuesta cambia files.content; reflejarlo en GitHub
  // y reindexar chunks en background.
  scheduleAutoReindex(result.fileId);
  return NextResponse.json({
    invocationId: id,
    versionId: result.versionId,
    content: result.content,
    status: "accepted",
  });
}
