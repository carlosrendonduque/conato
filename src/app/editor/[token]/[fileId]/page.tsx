import { and, desc, eq } from "drizzle-orm";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { db } from "@/lib/db/client";
import { fileVersions, files } from "@/lib/db/schema";
import { env } from "@/lib/env";
import { renderMarkdown } from "@/lib/markdown/render";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

interface PageProps {
  params: Promise<{ token: string; fileId: string }>;
  searchParams: Promise<{ v?: string }>;
}

export async function generateMetadata({
  params,
}: PageProps): Promise<Metadata> {
  const { token, fileId } = await params;
  if (!env.CONATO_EDITOR_TOKEN || token !== env.CONATO_EDITOR_TOKEN) {
    return { title: "Conato" };
  }
  const [file] = await db.select().from(files).where(eq(files.id, fileId));
  if (!file) return { title: "Conato" };
  const fm = (file.frontmatter ?? {}) as Record<string, unknown>;
  const title = typeof fm.title === "string" ? fm.title : file.path;
  return {
    title: `${title} — Conato`,
    robots: { index: false, follow: false },
  };
}

/**
 * Vista pública del editor externo. Tiene dos modos:
 *
 * 1. Modo "vivo" (URL sin `?v=`): renderiza el contenido actual del
 *    archivo. Es la URL canónica de lectura — las anotaciones externas
 *    fuzzy-anchora a texto que sobrevive entre ediciones, y marca como
 *    "Orphaned" lo que se reescribió.
 *
 * 2. Modo "snapshot" (URL con `?v=<versionId>`): renderiza el contenido
 *    de un milestone específico, read-only. Sirve como
 *    referencia para discutir versiones pasadas, pero la conversación
 *    sigue viviendo en la URL principal.
 *
 * Lista de milestones aparece como links en el header — solo
 * milestones, no auto-saves automáticos. El autor elige qué versiones
 * publica para terceros.
 */
export default async function EditorFileView({
  params,
  searchParams,
}: PageProps) {
  const { token, fileId } = await params;
  const { v: versionParam } = await searchParams;

  if (!env.CONATO_EDITOR_TOKEN || token !== env.CONATO_EDITOR_TOKEN) {
    notFound();
  }

  const [file] = await db.select().from(files).where(eq(files.id, fileId));
  if (!file) notFound();

  const fm = (file.frontmatter ?? {}) as Record<string, unknown>;
  if (fm.share_external !== true) notFound();

  // Lista de milestones para el selector del header. Solo milestones,
  // ordenados del más reciente al más viejo.
  const milestones = await db
    .select({
      id: fileVersions.id,
      milestoneLabel: fileVersions.milestoneLabel,
      createdAt: fileVersions.createdAt,
    })
    .from(fileVersions)
    .where(
      and(
        eq(fileVersions.fileId, fileId),
        eq(fileVersions.isMilestone, true),
      ),
    )
    .orderBy(desc(fileVersions.createdAt));

  // Si la URL pide ?v=<versionId>, validar que sea un milestone real
  // del mismo archivo y servir su contenido. Si no, mostrar live.
  let snapshotContent: string | null = null;
  let snapshotLabel: string | null = null;
  let snapshotDate: Date | null = null;
  if (versionParam) {
    const [snap] = await db
      .select()
      .from(fileVersions)
      .where(
        and(
          eq(fileVersions.id, versionParam),
          eq(fileVersions.fileId, fileId),
          eq(fileVersions.isMilestone, true),
        ),
      );
    if (!snap) notFound();
    snapshotContent = snap.content;
    snapshotLabel = snap.milestoneLabel;
    snapshotDate = snap.createdAt;
  }

  const isSnapshot = snapshotContent !== null;
  const html = renderMarkdown(
    isSnapshot ? (snapshotContent as string) : file.content,
  );

  return (
    <main className="mx-auto max-w-2xl px-6 py-12 font-serif">
      <nav className="mb-6 text-xs">
        <a
          href={`/editor/${token}`}
          className="text-neutral-500 hover:text-black"
        >
          ← volver al índice
        </a>
      </nav>

      {isSnapshot && (
        <div className="mb-6 rounded border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-900">
          <p className="font-medium">
            Estás viendo un snapshot histórico ({snapshotLabel ?? "sin etiqueta"}
            ) — solo lectura, sin sidebar de anotación.
          </p>
          <p className="mt-1">
            <a
              href={`/editor/${token}/${fileId}`}
              className="underline hover:text-amber-700"
            >
              Volver a la versión actual
            </a>{" "}
            para leer y comentar el estado más reciente.
          </p>
        </div>
      )}

      <header className="mb-6 border-b border-neutral-200 pb-4">
        <p className="font-mono text-xs text-neutral-500">{file.path}</p>
        {typeof fm.title === "string" && (
          <h1 className="mt-2 text-2xl">{fm.title}</h1>
        )}
        <p className="mt-3 text-[11px] text-neutral-400">
          {isSnapshot && snapshotDate
            ? `Snapshot publicado el ${snapshotDate.toLocaleString("es-ES", { dateStyle: "medium", timeStyle: "short" })}`
            : `Última edición: ${file.updatedAt.toLocaleString("es-ES", { dateStyle: "medium", timeStyle: "short" })}`}
        </p>

        {milestones.length > 0 && (
          <div className="mt-4 flex flex-wrap items-baseline gap-2 text-[11px]">
            <span className="text-neutral-500">Versiones publicadas:</span>
            {!isSnapshot ? (
              <span className="rounded bg-neutral-200 px-2 py-0.5 font-medium text-neutral-800">
                actual
              </span>
            ) : (
              <a
                href={`/editor/${token}/${fileId}`}
                className="rounded px-2 py-0.5 text-neutral-600 underline hover:bg-neutral-100"
              >
                actual
              </a>
            )}
            {milestones.map((m) => {
              const active = isSnapshot && m.id === versionParam;
              const label = m.milestoneLabel ?? "(sin etiqueta)";
              return active ? (
                <span
                  key={m.id}
                  className="rounded bg-amber-200 px-2 py-0.5 font-medium text-amber-900"
                >
                  {label}
                </span>
              ) : (
                <a
                  key={m.id}
                  href={`/editor/${token}/${fileId}?v=${m.id}`}
                  className="rounded px-2 py-0.5 text-neutral-600 underline hover:bg-neutral-100"
                >
                  {label}
                </a>
              );
            })}
          </div>
        )}
      </header>

      <article
        className="conato-prose text-[17px] leading-[1.7] text-black"
        dangerouslySetInnerHTML={{ __html: html }}
      />

    </main>
  );
}
