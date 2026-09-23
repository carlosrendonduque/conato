import { asc, eq } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { corpora, files } from "@/lib/db/schema";
import { Editor, type FileSummary } from "@/components/Editor";
import { env } from "@/lib/env";

export const dynamic = "force-dynamic";

export default async function Home() {
  const [corpus] = await db.select().from(corpora).limit(1);
  const fileList: FileSummary[] = corpus
    ? (
        await db
          .select({
            id: files.id,
            path: files.path,
            frontmatter: files.frontmatter,
          })
          .from(files)
          .where(eq(files.corpusId, corpus.id))
          .orderBy(asc(files.path))
      ).map((f) => {
        const fm = (f.frontmatter ?? {}) as Record<string, unknown>;
        return {
          id: f.id,
          path: f.path,
          shared: fm.share_external === true,
          title: typeof fm.title === "string" ? fm.title : undefined,
          kind: typeof fm.kind === "string" ? fm.kind : undefined,
          act: typeof fm.act === "number" ? fm.act : undefined,
          order: typeof fm.order === "number" ? fm.order : undefined,
          voice: typeof fm.voice === "string" ? fm.voice : undefined,
        };
      })
    : [];

  // El token se inyecta solo si está configurado; el componente decide si
  // muestra UI de compartir externo. Sale en el HTML del cliente, pero ese
  // HTML solo lo ve el autor (gated por auth) — el token es un secreto
  // compartido con lectores externos, no top-secret como el access.
  return <Editor files={fileList} editorToken={env.CONATO_EDITOR_TOKEN ?? null} />;
}
