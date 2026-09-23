import { createHash } from "node:crypto";
import { desc, eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db/client";
import { fileVersions, files } from "@/lib/db/schema";
import { scheduleAutoReindex } from "@/lib/rag/auto-reindex";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const bodySchema = z.object({ content: z.string() });

function hashContent(s: string): string {
  return createHash("sha256").update(s, "utf8").digest("hex");
}

/**
 * Auto-save granular del archivo. Si el hash del nuevo contenido coincide con
 * la última file_version, no inserta nada (idempotente — evita acumular ruido
 * en el historial cuando el cliente reenvía el mismo estado).
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

  const newContent = parsed.data.content;
  const newHash = hashContent(newContent);

  const result = await db.transaction(async (tx) => {
    const [file] = await tx.select().from(files).where(eq(files.id, id));
    if (!file) {
      return { kind: "err" as const, status: 404, error: "file_not_found" };
    }

    const [latest] = await tx
      .select()
      .from(fileVersions)
      .where(eq(fileVersions.fileId, file.id))
      .orderBy(desc(fileVersions.createdAt))
      .limit(1);

    if (latest && latest.contentHash === newHash) {
      return {
        kind: "ok" as const,
        noop: true,
        versionId: latest.id,
        contentHash: latest.contentHash,
      };
    }

    const [version] = await tx
      .insert(fileVersions)
      .values({
        fileId: file.id,
        parentVersionId: latest ? latest.id : null,
        content: newContent,
        contentHash: newHash,
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
      noop: false,
      versionId: version.id,
      contentHash: newHash,
    };
  });

  if (result.kind === "err") {
    return NextResponse.json({ error: result.error }, { status: result.status });
  }
  // Reindex en background si efectivamente cambió contenido (no en
  // noops). El cliente no espera: waitUntil mantiene la lambda viva
  // hasta que el proveedor de embeddings termine (1-3s).
  if (!result.noop) {
    scheduleAutoReindex(id);
  }
  return NextResponse.json({
    fileId: id,
    versionId: result.versionId,
    contentHash: result.contentHash,
    noop: result.noop,
  });
}
