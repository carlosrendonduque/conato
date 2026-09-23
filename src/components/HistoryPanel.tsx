"use client";

import { useEffect, useState } from "react";

interface VersionSummary {
  id: string;
  contentHash: string;
  isMilestone: boolean;
  milestoneLabel: string | null;
  createdAt: string;
  parentVersionId: string | null;
  contentLength: number;
  contentPreview: string;
}

interface Props {
  fileId: string;
  open: boolean;
  onClose: () => void;
  onRestored: (newContent: string) => void;
}

/**
 * Modal de historial. Lista versiones (auto-saves + milestones) más
 * recientes primero, con preview opcional al expandir una. Acciones:
 * "publicar versión actual" (marca la última como milestone con un
 * label) y "restaurar" (escribe el contenido viejo como nueva versión,
 * sin pisar el historial).
 *
 * Mobile: full-screen overlay. Desktop: centrado con backdrop. La lista
 * y el preview se apilan verticalmente; en pantallas amplias podríamos
 * separar lado a lado, pero para v1 vertical es suficiente.
 */
export function HistoryPanel({ fileId, open, onClose, onRestored }: Props) {
  const [versions, setVersions] = useState<VersionSummary[]>([]);
  const [loading, setLoading] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);
  const [expandedFor, setExpandedFor] = useState<string | null>(null);
  const [fullContent, setFullContent] = useState<string | null>(null);
  const [publishLabel, setPublishLabel] = useState<string>("");
  const [publishing, setPublishing] = useState<boolean>(false);
  const [restoringFor, setRestoringFor] = useState<string | null>(null);
  // Editar etiqueta de un milestone existente, o marcar/desmarcar el flag.
  const [editingLabelFor, setEditingLabelFor] = useState<string | null>(null);
  const [labelDraft, setLabelDraft] = useState<string>("");

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    (async () => {
      setLoading(true);
      setError(null);
      try {
        const res = await fetch(`/api/files/${fileId}/versions`);
        const data = (await res.json()) as { versions?: VersionSummary[] };
        if (cancelled) return;
        if (!res.ok) {
          setError("no se pudo cargar el historial");
          return;
        }
        setVersions(data.versions ?? []);
        // Default label sugerido: v(N+1) según milestones existentes.
        const milestones = (data.versions ?? []).filter((v) => v.isMilestone);
        setPublishLabel(`v${milestones.length + 1}`);
      } catch {
        if (!cancelled) setError("red");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [open, fileId]);

  if (!open) return null;

  async function loadFull(versionId: string) {
    setExpandedFor(versionId);
    setFullContent(null);
    try {
      const res = await fetch(`/api/files/${fileId}/versions/${versionId}`);
      const data = (await res.json()) as { content?: string };
      if (res.ok && typeof data.content === "string") {
        setFullContent(data.content);
      }
    } catch {
      setFullContent(null);
    }
  }

  async function handlePublish() {
    const label = publishLabel.trim();
    if (!label || publishing) return;
    setPublishing(true);
    try {
      const res = await fetch(`/api/files/${fileId}/versions`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ label }),
      });
      if (!res.ok) {
        setError("no se pudo publicar");
        return;
      }
      // Refrescar la lista para que aparezca el milestone marcado.
      const listRes = await fetch(`/api/files/${fileId}/versions`);
      const listData = (await listRes.json()) as {
        versions?: VersionSummary[];
      };
      if (listRes.ok) {
        setVersions(listData.versions ?? []);
        const ms = (listData.versions ?? []).filter((v) => v.isMilestone);
        setPublishLabel(`v${ms.length + 1}`);
      }
    } catch {
      setError("red");
    } finally {
      setPublishing(false);
    }
  }

  async function handleRestore(versionId: string) {
    if (restoringFor) return;
    if (!window.confirm("¿Restaurar esta versión? El contenido actual quedará registrado en el historial; no se pierde nada.")) {
      return;
    }
    setRestoringFor(versionId);
    try {
      const res = await fetch(
        `/api/files/${fileId}/versions/${versionId}/restore`,
        { method: "POST" },
      );
      const data = (await res.json()) as { content?: string };
      if (!res.ok || typeof data.content !== "string") {
        setError("no se pudo restaurar");
        return;
      }
      onRestored(data.content);
      // Refrescar lista — la restauración crea una versión nueva.
      const listRes = await fetch(`/api/files/${fileId}/versions`);
      const listData = (await listRes.json()) as {
        versions?: VersionSummary[];
      };
      if (listRes.ok) setVersions(listData.versions ?? []);
    } catch {
      setError("red");
    } finally {
      setRestoringFor(null);
    }
  }

  function startEditLabel(v: VersionSummary) {
    setEditingLabelFor(v.id);
    if (v.isMilestone) {
      setLabelDraft(v.milestoneLabel ?? "");
    } else {
      // Marcar como hito: pre-llenar con vN siguiente.
      const milestoneCount = versions.filter((x) => x.isMilestone).length;
      setLabelDraft(`v${milestoneCount + 1}`);
    }
    setError(null);
  }

  function cancelEditLabel() {
    setEditingLabelFor(null);
    setLabelDraft("");
  }

  /** PATCH del flag/label de un milestone. Reusa el endpoint para los
   *  tres casos: editar etiqueta, marcar como hito, desmarcar. */
  async function patchVersion(
    versionId: string,
    body: { isMilestone?: boolean; milestoneLabel?: string | null },
  ): Promise<boolean> {
    try {
      const res = await fetch(`/api/files/${fileId}/versions/${versionId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        setError("no se pudo actualizar el milestone");
        return false;
      }
      const updated = (await res.json()) as {
        isMilestone: boolean;
        milestoneLabel: string | null;
      };
      setVersions((prev) =>
        prev.map((x) =>
          x.id === versionId
            ? {
                ...x,
                isMilestone: updated.isMilestone,
                milestoneLabel: updated.milestoneLabel,
              }
            : x,
        ),
      );
      return true;
    } catch {
      setError("red");
      return false;
    }
  }

  /** Confirma la edición inline. Sirve tanto para renombrar un hito
   *  existente como para marcar uno nuevo: ambos casos terminan
   *  con isMilestone: true + milestoneLabel: <draft>. */
  async function commitEditLabel(versionId: string) {
    const next = labelDraft.trim();
    if (!next) {
      setError("la etiqueta no puede estar vacía");
      return;
    }
    setError(null);
    const ok = await patchVersion(versionId, {
      isMilestone: true,
      milestoneLabel: next,
    });
    if (ok) cancelEditLabel();
  }

  async function unmarkMilestone(versionId: string) {
    if (
      !window.confirm(
        "¿Desmarcar este hito? La versión se mantiene en el historial pero deja de aparecer en la página pública del editor externo.",
      )
    ) {
      return;
    }
    setError(null);
    await patchVersion(versionId, { isMilestone: false, milestoneLabel: null });
  }

  return (
    <>
      <div
        onClick={onClose}
        className="fixed inset-0 z-40 bg-black/40"
        aria-hidden
      />
      <div className="fixed inset-x-2 inset-y-4 z-50 mx-auto flex max-w-3xl flex-col overflow-hidden rounded-lg bg-white shadow-2xl md:inset-x-auto md:inset-y-8">
        <header className="flex items-center justify-between border-b border-neutral-200 px-4 py-3">
          <div>
            <h2 className="text-sm font-semibold">Historial</h2>
            <p className="text-[11px] text-neutral-500">
              {loading
                ? "cargando…"
                : `${versions.length} versiones · ${versions.filter((v) => v.isMilestone).length} hitos`}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="cerrar"
            className="text-neutral-500 hover:text-black"
          >
            ✕
          </button>
        </header>

        <div className="flex flex-col gap-3 border-b border-neutral-200 bg-neutral-50/60 p-3">
          <p className="text-[11px] uppercase tracking-wide text-neutral-500">
            Publicar versión actual como hito
          </p>
          <div className="flex gap-2">
            <input
              type="text"
              value={publishLabel}
              onChange={(e) => setPublishLabel(e.target.value)}
              placeholder="etiqueta (ej. v3, draft mayo)"
              className="flex-1 rounded border border-neutral-300 bg-white px-2 py-1.5 text-sm outline-none focus:border-neutral-500"
            />
            <button
              type="button"
              onClick={handlePublish}
              disabled={publishing || !publishLabel.trim()}
              className="rounded bg-neutral-900 px-3 py-1.5 text-sm text-white disabled:opacity-50"
            >
              {publishing ? "publicando…" : "publicar"}
            </button>
          </div>
          <p className="text-[11px] text-neutral-500">
            Un hito etiqueta la versión más reciente para que aparezca en
            la página pública del editor externo.
          </p>
        </div>

        {error && (
          <p className="border-b border-red-200 bg-red-50/50 px-4 py-2 text-xs text-red-700">
            error: {error}
          </p>
        )}

        <ul className="flex-1 divide-y divide-neutral-200 overflow-y-auto">
          {versions.length === 0 && !loading && (
            <li className="px-4 py-6 text-center text-sm text-neutral-400">
              Sin historial todavía. Empieza a editar y se irán
              acumulando versiones automáticamente.
            </li>
          )}
          {versions.map((v, i) => {
            const isLatest = i === 0;
            const isExpanded = expandedFor === v.id;
            const isEditingLabel = editingLabelFor === v.id;
            return (
              <li key={v.id}>
                <div className="flex flex-col gap-1.5 px-4 py-3">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-xs text-neutral-500">
                      {new Date(v.createdAt).toLocaleString("es-ES", {
                        dateStyle: "short",
                        timeStyle: "short",
                      })}
                    </span>
                    {isLatest && (
                      <span className="rounded bg-neutral-100 px-1.5 py-0.5 text-[10px] uppercase tracking-wide text-neutral-600">
                        actual
                      </span>
                    )}
                    {v.isMilestone && v.milestoneLabel && (
                      <span className="rounded bg-emerald-100 px-1.5 py-0.5 text-[11px] font-medium text-emerald-900">
                        {v.milestoneLabel}
                      </span>
                    )}
                    <span className="ml-auto text-[10px] text-neutral-400">
                      {v.contentLength} chars
                    </span>
                  </div>
                  {!isExpanded ? (
                    <p className="line-clamp-2 font-serif text-xs text-neutral-600">
                      {v.contentPreview || "(vacío)"}
                    </p>
                  ) : (
                    <pre className="max-h-64 overflow-y-auto whitespace-pre-wrap rounded border border-neutral-200 bg-neutral-50 p-2 font-serif text-xs text-black">
                      {fullContent ?? "cargando…"}
                    </pre>
                  )}
                  {isEditingLabel ? (
                    <div className="space-y-1.5 rounded border border-emerald-300 bg-emerald-50/40 p-2">
                      <p className="text-[11px] uppercase tracking-wide text-neutral-500">
                        {v.isMilestone
                          ? "renombrar etiqueta"
                          : "marcar como hito"}
                      </p>
                      <input
                        autoFocus
                        type="text"
                        value={labelDraft}
                        onChange={(e) => setLabelDraft(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === "Enter") {
                            e.preventDefault();
                            commitEditLabel(v.id);
                          } else if (e.key === "Escape") {
                            e.preventDefault();
                            cancelEditLabel();
                          }
                        }}
                        placeholder="ej. v3 / draft mayo / asesoría 2"
                        className="w-full rounded border border-neutral-300 px-2 py-1.5 text-xs outline-none focus:border-neutral-500"
                      />
                      <div className="flex gap-2">
                        <button
                          type="button"
                          onClick={() => commitEditLabel(v.id)}
                          className="rounded bg-neutral-900 px-2 py-1 text-xs text-white"
                        >
                          guardar
                        </button>
                        <button
                          type="button"
                          onClick={cancelEditLabel}
                          className="rounded bg-neutral-200 px-2 py-1 text-xs"
                        >
                          cancelar
                        </button>
                      </div>
                    </div>
                  ) : (
                    <div className="flex flex-wrap gap-2">
                      <button
                        type="button"
                        onClick={() =>
                          isExpanded ? setExpandedFor(null) : loadFull(v.id)
                        }
                        className="rounded px-2 py-1 text-xs text-neutral-700 hover:bg-neutral-100"
                      >
                        {isExpanded ? "ocultar" : "ver completo"}
                      </button>
                      {!isLatest && (
                        <button
                          type="button"
                          onClick={() => handleRestore(v.id)}
                          disabled={restoringFor === v.id}
                          className="rounded bg-amber-500 px-2 py-1 text-xs text-white disabled:opacity-50"
                        >
                          {restoringFor === v.id
                            ? "restaurando…"
                            : "restaurar"}
                        </button>
                      )}
                      {v.isMilestone ? (
                        <>
                          <button
                            type="button"
                            onClick={() => startEditLabel(v)}
                            className="rounded px-2 py-1 text-xs text-neutral-700 hover:bg-neutral-100"
                          >
                            renombrar etiqueta
                          </button>
                          <button
                            type="button"
                            onClick={() => unmarkMilestone(v.id)}
                            className="rounded px-2 py-1 text-xs text-neutral-700 hover:bg-neutral-100"
                          >
                            desmarcar
                          </button>
                        </>
                      ) : (
                        <button
                          type="button"
                          onClick={() => startEditLabel(v)}
                          className="rounded px-2 py-1 text-xs text-emerald-700 hover:bg-emerald-50"
                        >
                          marcar como hito
                        </button>
                      )}
                    </div>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      </div>
    </>
  );
}
