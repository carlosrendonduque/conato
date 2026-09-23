"use client";

import { EditorContent, useEditor, type Editor } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import { Markdown } from "tiptap-markdown";
import { useEffect, useRef } from "react";
import {
  CommentsExtension,
  type CommentAnchor,
  setCommentAnchors,
} from "@/components/CommentsExtension";

export interface MarkdownSelectionInfo {
  cursor: number;
  selection: {
    text: string;
    from: number;
    to: number;
    /** ~50 chars antes de la selección, en plain text. Sirve para
     *  desambiguar comentarios anclados a quotes que se repiten. */
    prefix: string;
    /** ~50 chars después de la selección. */
    suffix: string;
  } | null;
}

interface Props {
  content: string;
  disabled?: boolean;
  onChange: (markdown: string) => void;
  onSelectionChange: (info: MarkdownSelectionInfo) => void;
  /** Comentarios anclados al archivo activo. Cuando cambia esta lista,
   *  el plugin recompone las decoraciones inline. */
  commentAnchors?: CommentAnchor[];
  /** Click sobre el highlight de un comentario en el editor. */
  onCommentAnchorClick?: (commentId: string) => void;
  /** Si se setea, hace scroll a un anchor específico (por id). El
   *  componente busca el quote del comentario y lo lleva a viewport. */
  scrollToAnchor?: { id: string; quote: string; prefix: string; suffix: string } | null;
}

/**
 * Editor WYSIWYG sobre Tiptap. La fuente de verdad es Markdown crudo;
 * tiptap-markdown se encarga del round-trip. Las posiciones que reportamos
 * a `onSelectionChange` son offsets de carácter en el Markdown, no
 * posiciones de ProseMirror, para que el endpoint de invocación pueda
 * cortar `files.content` con `slice(from, to)` igual que con el textarea.
 */
export function MarkdownEditor({
  content,
  disabled,
  onChange,
  onSelectionChange,
  commentAnchors,
  onCommentAnchorClick,
  scrollToAnchor,
}: Props) {
  // Track del último Markdown que emitimos para evitar loops cuando el
  // padre nos devuelve el mismo content por props.
  const lastEmittedRef = useRef<string>(content);
  const onCommentAnchorClickRef = useRef(onCommentAnchorClick);
  onCommentAnchorClickRef.current = onCommentAnchorClick;

  const editor = useEditor({
    extensions: [
      StarterKit.configure({
        heading: { levels: [1, 2, 3] },
      }),
      Markdown.configure({
        html: false,
        breaks: false,
        transformPastedText: true,
        transformCopiedText: true,
      }),
      CommentsExtension.configure({
        onAnchorClick: (id: string) => {
          onCommentAnchorClickRef.current?.(id);
        },
      }),
    ],
    content,
    editable: !disabled,
    immediatelyRender: false,
    editorProps: {
      attributes: {
        class:
          "conato-prose flex-1 p-4 font-serif text-[17px] leading-[1.7] text-black outline-none md:p-6 md:text-base md:leading-relaxed",
      },
    },
    onUpdate: ({ editor }) => {
      const md = readMarkdown(editor);
      if (md === lastEmittedRef.current) return;
      lastEmittedRef.current = md;
      onChange(md);
      reportSelection(editor, onSelectionChange);
    },
    onSelectionUpdate: ({ editor }) => {
      reportSelection(editor, onSelectionChange);
    },
  });

  // Si el padre cambia `content` por una razón externa (cargar otro archivo,
  // aceptar una propuesta), reflejarlo en el editor sin disparar onChange.
  useEffect(() => {
    if (!editor) return;
    if (content === lastEmittedRef.current) return;
    lastEmittedRef.current = content;
    editor.commands.setContent(content, { emitUpdate: false });
  }, [content, editor]);

  // editable depende de disabled
  useEffect(() => {
    if (!editor) return;
    editor.setEditable(!disabled);
  }, [editor, disabled]);

  // Cuando cambian los anchors de comentarios, actualizar el plugin
  // para que recompute decoraciones. Sin esto, agregar/borrar un
  // comentario no se refleja visualmente en el editor.
  useEffect(() => {
    if (!editor) return;
    setCommentAnchors(editor, commentAnchors ?? []);
  }, [editor, commentAnchors]);

  // Si llega un request de scroll a un anchor específico, buscar el
  // quote en el doc y traerlo a viewport con foco en el rango.
  useEffect(() => {
    if (!editor || !scrollToAnchor) return;
    const view = editor.view;
    const doc = view.state.doc;
    const segments: Array<{ text: string; pmStart: number }> = [];
    doc.descendants((node, pos) => {
      if (node.isText && node.text) {
        segments.push({ text: node.text, pmStart: pos });
      }
      return true;
    });
    const fullText = segments.map((s) => s.text).join("");
    let idx = -1;
    if (scrollToAnchor.prefix || scrollToAnchor.suffix) {
      const search =
        scrollToAnchor.prefix + scrollToAnchor.quote + scrollToAnchor.suffix;
      idx = fullText.indexOf(search);
      if (idx !== -1) idx += scrollToAnchor.prefix.length;
    }
    if (idx === -1) idx = fullText.indexOf(scrollToAnchor.quote);
    if (idx === -1) return;
    let cur = 0;
    let from = -1;
    let to = -1;
    const endIdx = idx + scrollToAnchor.quote.length;
    for (const seg of segments) {
      const segLen = seg.text.length;
      const segStart = cur;
      const segEnd = cur + segLen;
      if (from === -1 && idx >= segStart && idx < segEnd) {
        from = seg.pmStart + (idx - segStart);
      }
      if (to === -1 && endIdx > segStart && endIdx <= segEnd) {
        to = seg.pmStart + (endIdx - segStart);
      }
      if (from !== -1 && to !== -1) break;
      cur = segEnd;
    }
    if (from === -1 || to === -1) return;
    // Hacer scroll a la posición y opcionalmente seleccionar el rango.
    view.dispatch(view.state.tr.scrollIntoView());
    const dom = view.coordsAtPos(from);
    if (dom) {
      view.dom.scrollIntoView({ behavior: "smooth", block: "center" });
      // Más preciso: scroll al elemento más cercano que contiene el rango.
      const node = view.nodeDOM(from) as HTMLElement | null;
      if (node && typeof node.scrollIntoView === "function") {
        node.scrollIntoView({ behavior: "smooth", block: "center" });
      }
    }
  }, [editor, scrollToAnchor]);

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
      <Toolbar editor={editor} />
      <EditorContent
        editor={editor}
        className="flex min-h-0 flex-1 flex-col overflow-y-auto"
      />
    </div>
  );
}

function readMarkdown(editor: Editor): string {
  const storage = editor.storage as { markdown?: { getMarkdown?: () => string } };
  return storage.markdown?.getMarkdown?.() ?? "";
}

function reportSelection(
  editor: Editor,
  onSelectionChange: (info: MarkdownSelectionInfo) => void,
): void {
  const { from, to } = editor.state.selection;
  const cursor = mdOffset(editor, from);
  if (from === to) {
    onSelectionChange({ cursor, selection: null });
    return;
  }
  const text = editor.state.doc.textBetween(from, to, "\n", "\n");
  const fromChar = mdOffset(editor, from);
  const toChar = mdOffset(editor, to);
  // prefix/suffix: ~50 chars de contexto antes/después en plain text.
  // Usamos `textBetween` con ventana razonable y truncamos. Para la
  // anclación de comentarios, no necesita ser exacto en chars — basta
  // con que ayude a desambiguar quotes repetidos.
  const PREFIX_CHARS = 60;
  const SUFFIX_CHARS = 60;
  const docSize = editor.state.doc.content.size;
  const prefixStart = Math.max(0, from - 200);
  const suffixEnd = Math.min(docSize, to + 200);
  const prefix = editor.state.doc
    .textBetween(prefixStart, from, "\n", "")
    .slice(-PREFIX_CHARS);
  const suffix = editor.state.doc
    .textBetween(to, suffixEnd, "\n", "")
    .slice(0, SUFFIX_CHARS);
  onSelectionChange({
    cursor,
    selection: { text, from: fromChar, to: toChar, prefix, suffix },
  });
}

/**
 * Convierte una posición de ProseMirror a offset en el Markdown serializado.
 * Estrategia: serializar el documento cortado en (0..pos) y medir el
 * resultado. La serialización de tiptap-markdown agrega un `\n` final por
 * bloque, así que recortamos para que la suma de offsets coincida con la
 * concatenación reportada por `getMarkdown()`.
 */
function mdOffset(editor: Editor, pos: number): number {
  if (pos <= 0) return 0;
  const slice = editor.state.doc.cut(0, pos);
  const storage = editor.storage as {
    markdown?: { serializer?: { serialize: (doc: unknown) => string } };
  };
  const serializer = storage.markdown?.serializer;
  if (!serializer) return 0;
  const md = serializer.serialize(slice);
  // Quitar el último newline que el serializer añade a bloques cerrados
  // para que la suma de cuts coincida con getMarkdown() del doc completo.
  return md.replace(/\n$/, "").length;
}

interface ToolbarProps {
  editor: Editor | null;
}

/**
 * Barra de formato austera, alineada con la estética de la obra:
 * etiquetas de texto en monospace, sin iconos coloridos. Los botones
 * resaltan cuando la marca/nodo está activa en la selección.
 */
function Toolbar({ editor }: ToolbarProps) {
  if (!editor) {
    return (
      <div className="border-b border-neutral-200 bg-neutral-50/50 px-2 py-1.5" />
    );
  }
  const Btn = ({
    label,
    onClick,
    active,
    title,
  }: {
    label: string;
    onClick: () => void;
    active?: boolean;
    title: string;
  }) => (
    <button
      type="button"
      onMouseDown={(e) => e.preventDefault()}
      onClick={onClick}
      title={title}
      aria-label={title}
      className={`flex h-8 min-w-[32px] items-center justify-center rounded px-2 font-mono text-xs transition-colors ${
        active
          ? "bg-neutral-200 text-black"
          : "text-neutral-600 hover:bg-neutral-100 hover:text-black"
      }`}
    >
      {label}
    </button>
  );
  const Sep = () => <span className="mx-0.5 h-4 w-px bg-neutral-300" />;
  return (
    <div className="flex flex-wrap items-center gap-0.5 border-b border-neutral-200 bg-neutral-50/50 px-2 py-1.5">
      <Btn
        label="B"
        title="Negrita"
        onClick={() => editor.chain().focus().toggleBold().run()}
        active={editor.isActive("bold")}
      />
      <Btn
        label="I"
        title="Cursiva"
        onClick={() => editor.chain().focus().toggleItalic().run()}
        active={editor.isActive("italic")}
      />
      <Btn
        label="S"
        title="Tachado"
        onClick={() => editor.chain().focus().toggleStrike().run()}
        active={editor.isActive("strike")}
      />
      <Btn
        label="`"
        title="Código inline"
        onClick={() => editor.chain().focus().toggleCode().run()}
        active={editor.isActive("code")}
      />
      <Sep />
      <Btn
        label="H1"
        title="Encabezado 1"
        onClick={() =>
          editor.chain().focus().toggleHeading({ level: 1 }).run()
        }
        active={editor.isActive("heading", { level: 1 })}
      />
      <Btn
        label="H2"
        title="Encabezado 2"
        onClick={() =>
          editor.chain().focus().toggleHeading({ level: 2 }).run()
        }
        active={editor.isActive("heading", { level: 2 })}
      />
      <Btn
        label="H3"
        title="Encabezado 3"
        onClick={() =>
          editor.chain().focus().toggleHeading({ level: 3 }).run()
        }
        active={editor.isActive("heading", { level: 3 })}
      />
      <Sep />
      <Btn
        label="•"
        title="Lista"
        onClick={() => editor.chain().focus().toggleBulletList().run()}
        active={editor.isActive("bulletList")}
      />
      <Btn
        label="1."
        title="Lista numerada"
        onClick={() => editor.chain().focus().toggleOrderedList().run()}
        active={editor.isActive("orderedList")}
      />
      <Btn
        label="❝"
        title="Cita"
        onClick={() => editor.chain().focus().toggleBlockquote().run()}
        active={editor.isActive("blockquote")}
      />
      <Btn
        label="―"
        title="Línea horizontal"
        onClick={() => editor.chain().focus().setHorizontalRule().run()}
      />
    </div>
  );
}
