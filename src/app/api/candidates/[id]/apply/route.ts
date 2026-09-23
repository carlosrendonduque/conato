import { createHash } from "node:crypto";
import { desc, eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { z } from "zod";
import {
  joinFrontmatter,
  splitFrontmatter,
} from "@/lib/corpus/frontmatter";
import { db } from "@/lib/db/client";
import { scheduleAutoReindex } from "@/lib/rag/auto-reindex";
import {
  candidates,
  fileVersions,
  files,
  invocations,
} from "@/lib/db/schema";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

function hashContent(s: string): string {
  return createHash("sha256").update(s, "utf8").digest("hex");
}

const bodySchema = z.union([
  z.object({
    selection: z.object({
      range: z.object({
        from: z.number().int().nonnegative(),
        to: z.number().int().nonnegative(),
      }),
    }),
  }),
  z.object({
    cursorPosition: z.number().int().nonnegative(),
  }),
]);

/**
 * Aplica el texto de un candidato guardado a la ubicación actual del cliente
 * (selección o cursor). NO toca el candidato — sigue disponible para volver a
 * aplicarse en otro lugar. Crea una nueva fila en file_versions para que el
 * historial quede registrado.
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
    return NextResponse.json(
      { error: "invalid_request", issues: parsed.error.flatten() },
      { status: 400 },
    );
  }

  const result = await db.transaction(async (tx) => {
    const [cand] = await tx
      .select()
      .from(candidates)
      .where(eq(candidates.id, id));
    if (!cand) {
      return {
        kind: "err" as const,
        status: 404,
        error: "candidate_not_found",
      };
    }
    const [inv] = await tx
      .select()
      .from(invocations)
      .where(eq(invocations.id, cand.invocationId));
    if (!inv) {
      return {
        kind: "err" as const,
        status: 404,
        error: "invocation_not_found",
      };
    }
    const [file] = await tx
      .select()
      .from(files)
      .where(eq(files.id, cand.fileId));
    if (!file) {
      return { kind: "err" as const, status: 404, error: "file_not_found" };
    }

    // Los offsets vienen del editor, que trabaja sobre el cuerpo sin
    // frontmatter. Aplicamos ahí y volvemos a pegar el bloque intacto.
    const { frontmatter, body } = splitFrontmatter(file.content);
    let newBody: string;
    if ("selection" in parsed.data) {
      const { from, to } = parsed.data.selection.range;
      newBody = body.slice(0, from) + inv.responseText + body.slice(to);
    } else {
      const pos = parsed.data.cursorPosition;
      newBody = body.slice(0, pos) + inv.responseText + body.slice(pos);
    }
    const newContent = joinFrontmatter(frontmatter, newBody);

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

    await tx
      .update(files)
      .set({ content: newContent })
      .where(eq(files.id, file.id));

    return {
      kind: "ok" as const,
      content: newContent,
      versionId: version.id,
      fileId: file.id,
    };
  });

  if (result.kind === "err") {
    return NextResponse.json({ error: result.error }, { status: result.status });
  }
  // Aplicar candidato muta files.content; reflejarlo en GitHub y
  // reindexar chunks en background.
  scheduleAutoReindex(result.fileId);
  return NextResponse.json({
    candidateId: id,
    content: result.content,
    versionId: result.versionId,
  });
}
