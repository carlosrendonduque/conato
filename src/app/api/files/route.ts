import { asc, eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db/client";
import { corpora, files } from "@/lib/db/schema";
import { scheduleAutoReindex } from "@/lib/rag/auto-reindex";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET() {
  const [corpus] = await db.select().from(corpora).limit(1);
  if (!corpus) {
    return NextResponse.json({ files: [] });
  }
  const rows = await db
    .select({
      id: files.id,
      path: files.path,
      baseName: files.baseName,
      language: files.language,
      corpusLayer: files.corpusLayer,
      frontmatter: files.frontmatter,
    })
    .from(files)
    .where(eq(files.corpusId, corpus.id))
    .orderBy(asc(files.path));
  const out = rows.map((f) => {
    const fm = (f.frontmatter ?? {}) as Record<string, unknown>;
    return {
      id: f.id,
      path: f.path,
      baseName: f.baseName,
      language: f.language,
      corpusLayer: f.corpusLayer,
      shared: fm.share_external === true,
      title: typeof fm.title === "string" ? fm.title : undefined,
      kind: typeof fm.kind === "string" ? fm.kind : undefined,
      act: typeof fm.act === "number" ? fm.act : undefined,
      order: typeof fm.order === "number" ? fm.order : undefined,
      voice: typeof fm.voice === "string" ? fm.voice : undefined,
    };
  });
  return NextResponse.json({ files: out });
}

const createSchema = z.object({
  path: z.string().min(1),
  content: z.string().optional(),
  corpusLayer: z.enum(["canon", "production", "meta"]).optional(),
});

/**
 * Convención del corpus: `<base>.<lang>.<ext>` (CLAUDE.md). Si el path no
 * encaja, rechazamos: la jerarquía canónica es parte del valor de Conato y
 * relajarla aquí solo crearía deuda.
 */
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

export async function POST(req: Request) {
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

  const [corpus] = await db.select().from(corpora).limit(1);
  if (!corpus) {
    return NextResponse.json(
      { error: "no_corpus_seeded" },
      { status: 500 },
    );
  }

  // Smart default: si el path tiene la convención `acto_NN/MM_xxx.es.md`,
  // pre-poblar frontmatter con act=NN y order=MM. El autor puede sobrescribir
  // luego desde la UI de metadata. Para paths que no encajen, frontmatter
  // arranca vacío.
  const inferredFrontmatter: Record<string, unknown> = {};
  const m = /^acto_0*(\d+)\/0*(\d+)_/.exec(inputPath);
  if (m) {
    inferredFrontmatter.act = Number(m[1]);
    inferredFrontmatter.order = Number(m[2]);
    inferredFrontmatter.kind = "escena";
  }

  const inserted = await db
    .insert(files)
    .values({
      corpusId: corpus.id,
      path: inputPath,
      baseName: components.baseName,
      language: components.language,
      extension: components.extension,
      content: parsed.data.content ?? "",
      corpusLayer: parsed.data.corpusLayer ?? "production",
      frontmatter: inferredFrontmatter,
    })
    .onConflictDoNothing()
    .returning({
      id: files.id,
      path: files.path,
      baseName: files.baseName,
      language: files.language,
      corpusLayer: files.corpusLayer,
    });

  if (inserted.length === 0) {
    return NextResponse.json(
      { error: "path_already_exists", path: inputPath },
      { status: 409 },
    );
  }
  const insertedRow = inserted[0];
  if (!insertedRow) {
    return NextResponse.json({ error: "insert_failed" }, { status: 500 });
  }
  // Reindex en background. Si el archivo se crea con contenido vacío,
  // indexFile no escribe chunks pero igual es seguro llamarlo.
  scheduleAutoReindex(insertedRow.id);
  return NextResponse.json(insertedRow);
}
