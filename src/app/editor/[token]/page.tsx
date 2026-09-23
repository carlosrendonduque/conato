import { sql } from "drizzle-orm";
import { notFound } from "next/navigation";
import { db } from "@/lib/db/client";
import { corpora, files } from "@/lib/db/schema";
import { env } from "@/lib/env";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

interface PageProps {
  params: Promise<{ token: string }>;
}

/**
 * Índice de archivos compartidos vía share_external. Lista los `.md`
 * marcados como compartibles, con link a su vista renderizada. Si el
 * token de la URL no coincide con `CONATO_EDITOR_TOKEN`, 404 silencioso.
 */
export default async function EditorIndex({ params }: PageProps) {
  const { token } = await params;
  if (!env.CONATO_EDITOR_TOKEN || token !== env.CONATO_EDITOR_TOKEN) {
    notFound();
  }

  const [corpus] = await db.select({ name: corpora.name }).from(corpora).limit(1);

  const shared = await db
    .select({
      id: files.id,
      path: files.path,
      frontmatter: files.frontmatter,
      updatedAt: files.updatedAt,
    })
    .from(files)
    .where(sql`${files.frontmatter}->>'share_external' = 'true'`)
    .orderBy(files.path);

  return (
    <main className="mx-auto max-w-2xl px-6 py-12 font-serif">
      <header className="mb-8 border-b border-neutral-200 pb-4">
        <p className="text-xs uppercase tracking-wide text-neutral-500">
          Material compartido
        </p>
        <h1 className="mt-2 text-2xl">{corpus?.name ?? "Work in progress"}</h1>
        <p className="mt-2 text-sm text-neutral-600">
          Archivos compartidos para lectura.
        </p>
      </header>

      {shared.length === 0 ? (
        <p className="text-sm text-neutral-500">
          Todavía no hay archivos compartidos.
        </p>
      ) : (
        <ul className="space-y-3">
          {shared.map((f) => {
            const fm = (f.frontmatter ?? {}) as Record<string, unknown>;
            const title = typeof fm.title === "string" ? fm.title : null;
            return (
              <li key={f.id}>
                <a
                  href={`/editor/${token}/${f.id}`}
                  className="block rounded border border-neutral-200 p-4 hover:border-neutral-400"
                >
                  <p className="font-mono text-xs text-neutral-500">{f.path}</p>
                  {title && (
                    <p className="mt-1 text-base text-black">{title}</p>
                  )}
                  <p className="mt-1 text-[11px] text-neutral-400">
                    Actualizado{" "}
                    {new Date(f.updatedAt).toLocaleString("es-ES", {
                      dateStyle: "medium",
                      timeStyle: "short",
                    })}
                  </p>
                </a>
              </li>
            );
          })}
        </ul>
      )}
    </main>
  );
}
