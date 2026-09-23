import { eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db/client";
import { files } from "@/lib/db/schema";

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
  const [file] = await db.select().from(files).where(eq(files.id, id));
  if (!file) {
    return NextResponse.json({ error: "file_not_found" }, { status: 404 });
  }
  return NextResponse.json({
    id: file.id,
    path: file.path,
    baseName: file.baseName,
    language: file.language,
    content: file.content,
    frontmatter: file.frontmatter,
    corpusLayer: file.corpusLayer,
  });
}

const patchSchema = z.object({
  path: z.string().min(1),
});

/** Convención: `<base>.<lang>.<ext>`. Igual que en POST /api/files. */
function parseFilename(filename: string): {
  baseName: string;
  language: string;
  extension: string;
} | null {
  const m = /^(?<base>.+)\.(?<lang>[a-z]{2})\.(?<ext>[a-z0-9]+)$/i.exec(
    filename,
  );
  if (!m || !m.groups) return null;
  const { base, lang, ext } = m.groups;
  if (!base || !lang || !ext) return null;
  return {
    baseName: base,
    language: lang.toLowerCase(),
    extension: ext.toLowerCase(),
  };
}

export async function PATCH(
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
  const parsed = patchSchema.safeParse(raw);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "invalid_request", issues: parsed.error.flatten() },
      { status: 400 },
    );
  }

  const inputPath = parsed.data.path.trim().replace(/^\/+/, "");
  const filename = inputPath.split("/").pop() ?? "";
  const components = parseFilename(filename);
  if (!components) {
    return NextResponse.json(
      {
        error: "invalid_path_format",
        detail:
          "Convención: <ruta>/<base>.<lang>.<ext>. Ejemplo: catalino/escena.es.md",
      },
      { status: 400 },
    );
  }

  // Si el path nuevo coincide con otro archivo del mismo corpus, devolvemos
  // 409 en vez de pisar — el unique index del schema lo bloquea, pero damos
  // un error legible.
  try {
    const [updated] = await db
      .update(files)
      .set({
        path: inputPath,
        baseName: components.baseName,
        language: components.language,
        extension: components.extension,
        updatedAt: new Date(),
      })
      .where(eq(files.id, id))
      .returning({
        id: files.id,
        path: files.path,
        baseName: files.baseName,
        language: files.language,
        corpusLayer: files.corpusLayer,
      });
    if (!updated) {
      return NextResponse.json({ error: "file_not_found" }, { status: 404 });
    }
    return NextResponse.json(updated);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    if (/unique|duplicate/i.test(message)) {
      return NextResponse.json(
        { error: "path_already_exists", path: inputPath },
        { status: 409 },
      );
    }
    return NextResponse.json(
      { error: "rename_failed", detail: message },
      { status: 500 },
    );
  }
}

export async function DELETE(
  _req: Request,
  ctx: { params: Promise<{ id: string }> },
) {
  const { id } = await ctx.params;
  if (!z.string().uuid().safeParse(id).success) {
    return NextResponse.json({ error: "invalid_id" }, { status: 400 });
  }
  // Las cascadas del schema (file_versions, invocations, candidates,
  // chunks, comments) se encargan; basta con borrar la fila del archivo.
  const [deleted] = await db
    .delete(files)
    .where(eq(files.id, id))
    .returning({ id: files.id });
  if (!deleted) {
    return NextResponse.json({ error: "file_not_found" }, { status: 404 });
  }
  return NextResponse.json({ deleted: true });
}
