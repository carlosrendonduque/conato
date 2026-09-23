"use client";

import { Extension } from "@tiptap/core";
import { Plugin, PluginKey } from "@tiptap/pm/state";
import type { Node as PmNode } from "@tiptap/pm/model";
import { Decoration, DecorationSet } from "@tiptap/pm/view";
import type { Editor } from "@tiptap/react";

export interface CommentAnchor {
  id: string;
  quote: string;
  prefix: string;
  suffix: string;
}

interface CommentsState {
  anchors: CommentAnchor[];
}

export const commentsPluginKey = new PluginKey<CommentsState>(
  "comments-anchors",
);

/**
 * Actualiza la lista de anchors del plugin para que recompute las
 * decoraciones. Se llama desde React cuando la lista de comentarios
 * cambia (created/edited/deleted/resolved).
 */
export function setCommentAnchors(
  editor: Editor | null,
  anchors: CommentAnchor[],
): void {
  if (!editor || editor.isDestroyed) return;
  const view = editor.view;
  view.dispatch(view.state.tr.setMeta(commentsPluginKey, { anchors }));
}

interface ExtensionOptions {
  onAnchorClick: (commentId: string) => void;
}

/**
 * Extensión que dibuja decoraciones inline sobre el texto comentado.
 * No modifica el documento — las decoraciones son runtime-only, no se
 * persisten en el Markdown que se sincroniza a GitHub. Eso evita el
 * problema clásico de marks que se pierden en el round-trip MD↔Tiptap.
 *
 * Los anchors se buscan por: prefix + quote + suffix (para desambiguar
 * cuando el quote se repite). Si el texto se reescribió y el quote ya
 * no se encuentra, el comentario queda "huérfano" — visible en el
 * panel pero sin decoración en el editor.
 */
export const CommentsExtension = Extension.create<ExtensionOptions>({
  name: "commentsAnchors",
  addOptions() {
    return {
      onAnchorClick: () => {
        /* default no-op */
      },
    };
  },
  addProseMirrorPlugins() {
    const onAnchorClick = this.options.onAnchorClick;
    return [
      new Plugin<CommentsState>({
        key: commentsPluginKey,
        state: {
          init: () => ({ anchors: [] }),
          apply(tr, oldState) {
            const meta = tr.getMeta(commentsPluginKey) as
              | { anchors?: CommentAnchor[] }
              | undefined;
            if (meta && Array.isArray(meta.anchors)) {
              return { anchors: meta.anchors };
            }
            return oldState;
          },
        },
        props: {
          decorations(state) {
            const ps = commentsPluginKey.getState(state);
            if (!ps || ps.anchors.length === 0) return DecorationSet.empty;
            const decos: Decoration[] = [];
            for (const a of ps.anchors) {
              const range = findAnchorRange(state.doc, a);
              if (range) {
                decos.push(
                  Decoration.inline(range.from, range.to, {
                    class: "conato-comment-anchor",
                    "data-comment-id": a.id,
                  }),
                );
              }
            }
            return DecorationSet.create(state.doc, decos);
          },
          handleClick(_view, _pos, event) {
            const target = event.target as HTMLElement | null;
            if (!target) return false;
            const el = target.closest("[data-comment-id]") as HTMLElement | null;
            if (!el) return false;
            const id = el.getAttribute("data-comment-id");
            if (!id) return false;
            onAnchorClick(id);
            return true;
          },
        },
      }),
    ];
  },
});

/**
 * Busca el rango de PM positions correspondiente al anchor del
 * comentario. Estrategia:
 *  1) prefix + quote + suffix → más específico, único en general.
 *  2) si no aparece, fallback a quote solo (toma la primera ocurrencia).
 *  3) null si no se encuentra → comentario huérfano.
 */
function findAnchorRange(
  doc: PmNode,
  anchor: CommentAnchor,
): { from: number; to: number } | null {
  // Recolectar todos los text nodes con su PM start position.
  const segments: Array<{ text: string; pmStart: number }> = [];
  doc.descendants((node, pos) => {
    if (node.isText && node.text) {
      segments.push({ text: node.text, pmStart: pos });
    }
    return true;
  });
  if (segments.length === 0) return null;
  const fullText = segments.map((s) => s.text).join("");

  let idx = -1;
  if (anchor.prefix || anchor.suffix) {
    const search = anchor.prefix + anchor.quote + anchor.suffix;
    idx = fullText.indexOf(search);
    if (idx !== -1) idx += anchor.prefix.length;
  }
  if (idx === -1) idx = fullText.indexOf(anchor.quote);
  if (idx === -1) return null;

  return textOffsetsToPmRange(segments, idx, idx + anchor.quote.length);
}

/**
 * Convierte offsets en el texto concatenado (sin separadores entre
 * bloques) a positions de ProseMirror. Soporta quotes que cruzan
 * múltiples text nodes (por marcas que cambian — bold, italic).
 */
function textOffsetsToPmRange(
  segments: Array<{ text: string; pmStart: number }>,
  textStart: number,
  textEnd: number,
): { from: number; to: number } | null {
  let cur = 0;
  let from = -1;
  let to = -1;
  for (const seg of segments) {
    const segLen = seg.text.length;
    const segStart = cur;
    const segEnd = cur + segLen;
    if (from === -1 && textStart >= segStart && textStart < segEnd) {
      from = seg.pmStart + (textStart - segStart);
    }
    if (to === -1 && textEnd > segStart && textEnd <= segEnd) {
      to = seg.pmStart + (textEnd - segStart);
    }
    if (from !== -1 && to !== -1) break;
    cur = segEnd;
  }
  if (from === -1 || to === -1) return null;
  return { from, to };
}
