"use client";

import { useEffect, useRef, useState } from "react";

export interface Comment {
  id: string;
  fileId: string;
  anchorMarkId: string;
  body: string;
  anchorQuote: string;
  anchorPrefix: string;
  anchorSuffix: string;
  visibleToAi: boolean;
  resolvedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

interface Props {
  fileId: string;
  open: boolean;
  onClose: () => void;
  /** Texto seleccionado actualmente en el editor (vacío si no hay
   *  selección). Se usa como anchor del nuevo comentario. */
  selectionText: string;
  /** Contexto de la selección para desambiguar cuando el quote se
   *  repite. Pasamos ~50 chars antes/después si hay. */
  selectionPrefix: string;
  selectionSuffix: string;
  /** Notifica al editor para que recargue las decoraciones cuando la
   *  lista cambia (created/updated/deleted/resolved). */
  onCommentsChanged: (comments: Comment[]) => void;
  /** Click en un comentario del panel: el editor hace scroll al anchor. */
  onJumpToComment: (comment: Comment) => void;
}

/**
 * Panel de comentarios personales del archivo activo. Anclados al texto
 * vía `anchorQuote` + prefix/suffix de contexto. v1: notas privadas
 * del autor (no las ve la IA).
 */
export function CommentsPanel({
  fileId,
  open,
  onClose,
  selectionText,
  selectionPrefix,
  selectionSuffix,
  onCommentsChanged,
  onJumpToComment,
}: Props) {
  const [comments, setComments] = useState<Comment[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [draftBody, setDraftBody] = useState("");
  const [creating, setCreating] = useState(false);
  const [editingFor, setEditingFor] = useState<string | null>(null);
  const [editDraft, setEditDraft] = useState("");
  const lastNotifiedRef = useRef<Comment[] | null>(null);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    (async () => {
      setLoading(true);
      setError(null);
      try {
        const res = await fetch(`/api/files/${fileId}/comments`);
        const data = (await res.json()) as { comments?: Comment[] };
        if (cancelled) return;
        if (!res.ok) {
          setError("no se pudo cargar los comentarios");
          return;
        }
        const list = data.comments ?? [];
        setComments(list);
        if (lastNotifiedRef.current !== list) {
          lastNotifiedRef.current = list;
          onCommentsChanged(list);
        }
      } catch {
        if (!cancelled) setError("red");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [open, fileId, onCommentsChanged]);

  if (!open) return null;

  async function handleCreate() {
    const body = draftBody.trim();
    if (!body || creating) return;
    if (selectionText.trim() === "") {
      setError("selecciona texto en el editor para anclar el comentario");
      return;
    }
    setCreating(true);
    setError(null);
    try {
      const res = await fetch(`/api/files/${fileId}/comments`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          body,
          anchorQuote: selectionText,
          anchorPrefix: selectionPrefix,
          anchorSuffix: selectionSuffix,
        }),
      });
      const data = (await res.json()) as Record<string, unknown>;
      if (!res.ok) {
        const detail =
          typeof data.detail === "string" ? `: ${data.detail}` : "";
        setError(`no se pudo crear el comentario${detail}`);
        return;
      }
      const created = data as unknown as Comment;
      const next = [...comments, created];
      setComments(next);
      onCommentsChanged(next);
      setDraftBody("");
    } catch {
      setError("red");
    } finally {
      setCreating(false);
    }
  }

  async function handleResolveToggle(c: Comment) {
    try {
      const res = await fetch(`/api/comments/${c.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ resolved: c.resolvedAt === null }),
      });
      if (!res.ok) return;
      const updated = (await res.json()) as Comment;
      const next = comments.map((x) => (x.id === c.id ? updated : x));
      setComments(next);
      onCommentsChanged(next);
    } catch {
      /* silent */
    }
  }

  async function handleDelete(c: Comment) {
    if (
      !window.confirm(
        "¿Eliminar este comentario? Se borra permanentemente, no se puede deshacer.",
      )
    ) {
      return;
    }
    try {
      const res = await fetch(`/api/comments/${c.id}`, { method: "DELETE" });
      if (!res.ok) return;
      const next = comments.filter((x) => x.id !== c.id);
      setComments(next);
      onCommentsChanged(next);
    } catch {
      /* silent */
    }
  }

  async function handleEditCommit(c: Comment) {
    const body = editDraft.trim();
    if (!body) return;
    try {
      const res = await fetch(`/api/comments/${c.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ body }),
      });
      if (!res.ok) return;
      const updated = (await res.json()) as Comment;
      const next = comments.map((x) => (x.id === c.id ? updated : x));
      setComments(next);
      onCommentsChanged(next);
      setEditingFor(null);
      setEditDraft("");
    } catch {
      /* silent */
    }
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
            <h2 className="text-sm font-semibold">Comentarios</h2>
            <p className="text-[11px] text-neutral-500">
              {loading
                ? "cargando…"
                : `${comments.length} ${comments.length === 1 ? "comentario" : "comentarios"} · solo tú los ves`}
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

        <div className="flex flex-col gap-2 border-b border-neutral-200 bg-neutral-50/60 p-3">
          <p className="text-[11px] uppercase tracking-wide text-neutral-500">
            Anotar selección actual
          </p>
          {selectionText ? (
            <p className="max-h-20 overflow-y-auto rounded border border-neutral-200 bg-white p-2 font-serif text-xs italic text-neutral-700">
              {selectionText}
            </p>
          ) : (
            <p className="rounded border border-dashed border-neutral-300 bg-white p-2 text-[11px] text-neutral-500">
              Selecciona texto en el editor para anclar un comentario.
            </p>
          )}
          <textarea
            value={draftBody}
            onChange={(e) => setDraftBody(e.target.value)}
            placeholder='nota sobre el fragmento (ej. "revisar fecha", "ritmo no convence")'
            rows={3}
            disabled={!selectionText}
            className="w-full resize-none rounded border border-neutral-300 bg-white px-2 py-1.5 text-sm outline-none focus:border-neutral-500 disabled:opacity-50"
          />
          <div className="flex gap-2">
            <button
              type="button"
              onClick={handleCreate}
              disabled={creating || !selectionText || !draftBody.trim()}
              className="rounded bg-neutral-900 px-3 py-1.5 text-sm text-white disabled:opacity-50"
            >
              {creating ? "guardando…" : "anotar"}
            </button>
          </div>
        </div>

        {error && (
          <p className="border-b border-red-200 bg-red-50/50 px-4 py-2 text-xs text-red-700">
            error: {error}
          </p>
        )}

        <ul className="flex-1 divide-y divide-neutral-200 overflow-y-auto">
          {comments.length === 0 && !loading && (
            <li className="px-4 py-6 text-center text-sm text-neutral-400">
              Sin comentarios todavía. Selecciona texto, escribe una nota,
              presiona &quot;anotar&quot;.
            </li>
          )}
          {comments.map((c) => {
            const resolved = c.resolvedAt !== null;
            const editing = editingFor === c.id;
            return (
              <li key={c.id} className={resolved ? "opacity-50" : ""}>
                <div className="flex flex-col gap-1.5 px-4 py-3">
                  <button
                    type="button"
                    onClick={() => onJumpToComment(c)}
                    className="block w-full rounded border border-neutral-200 bg-neutral-50 p-2 text-left font-serif text-xs italic text-neutral-700 hover:bg-neutral-100"
                    title="ir al texto anclado"
                  >
                    {c.anchorQuote || "(anchor vacío)"}
                  </button>
                  {editing ? (
                    <>
                      <textarea
                        autoFocus
                        value={editDraft}
                        onChange={(e) => setEditDraft(e.target.value)}
                        rows={2}
                        className="w-full resize-none rounded border border-neutral-300 bg-white px-2 py-1.5 text-sm outline-none focus:border-neutral-500"
                      />
                      <div className="flex gap-2">
                        <button
                          type="button"
                          onClick={() => handleEditCommit(c)}
                          className="rounded bg-neutral-900 px-2 py-1 text-xs text-white"
                        >
                          guardar
                        </button>
                        <button
                          type="button"
                          onClick={() => {
                            setEditingFor(null);
                            setEditDraft("");
                          }}
                          className="rounded bg-neutral-200 px-2 py-1 text-xs"
                        >
                          cancelar
                        </button>
                      </div>
                    </>
                  ) : (
                    <p className="whitespace-pre-wrap text-sm text-black">
                      {c.body}
                    </p>
                  )}
                  <div className="flex flex-wrap items-center gap-2 text-[11px]">
                    <span className="text-neutral-400">
                      {new Date(c.createdAt).toLocaleString("es-ES", {
                        dateStyle: "short",
                        timeStyle: "short",
                      })}
                    </span>
                    {resolved && (
                      <span className="rounded bg-emerald-100 px-1.5 py-0.5 text-emerald-900">
                        resuelto
                      </span>
                    )}
                    <span className="ml-auto flex gap-2">
                      {!editing && (
                        <button
                          type="button"
                          onClick={() => {
                            setEditingFor(c.id);
                            setEditDraft(c.body);
                          }}
                          className="text-neutral-500 hover:text-neutral-900"
                        >
                          editar
                        </button>
                      )}
                      <button
                        type="button"
                        onClick={() => handleResolveToggle(c)}
                        className="text-neutral-500 hover:text-neutral-900"
                      >
                        {resolved ? "reabrir" : "resolver"}
                      </button>
                      <button
                        type="button"
                        onClick={() => handleDelete(c)}
                        className="text-red-600 hover:text-red-800"
                      >
                        eliminar
                      </button>
                    </span>
                  </div>
                </div>
              </li>
            );
          })}
        </ul>
      </div>
    </>
  );
}
