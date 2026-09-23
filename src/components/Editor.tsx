"use client";

import { diffWords } from "diff";
import {
  type FormEvent,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { CommentsPanel, type Comment } from "@/components/CommentsPanel";
import type { CommentAnchor } from "@/components/CommentsExtension";
import { HistoryPanel } from "@/components/HistoryPanel";
import { IndexView } from "@/components/IndexView";
import {
  joinFrontmatter,
  splitFrontmatter,
} from "@/lib/corpus/frontmatter";
import { OverflowMenu } from "@/components/OverflowMenu";
import {
  MarkdownEditor,
  type MarkdownSelectionInfo,
} from "@/components/MarkdownEditor";

const AUTOSAVE_DEBOUNCE_MS = 3000;
type SaveState = "guardado" | "sin_guardar" | "guardando" | "error";

const OPERATIONS = [
  "free_prompt",
  "expand",
  "contract",
  "rewrite",
  "continue",
] as const;
type Operation = (typeof OPERATIONS)[number];

// Modelos ofrecidos en el selector. El primero es el default. Cambiar de
// modelo entre invocaciones es el gesto central: se manda la misma
// operación a otro modelo y el panel acumula ambas respuestas para
// compararlas.
const MODELS = [
  { id: "claude-opus-5", label: "Claude Opus 5" },
  { id: "claude-sonnet-5", label: "Claude Sonnet 5" },
  { id: "claude-haiku-4-5", label: "Claude Haiku 4.5" },
] as const;
type ModelId = (typeof MODELS)[number]["id"];

const MODEL_LABELS: Record<ModelId, string> = Object.fromEntries(
  MODELS.map((m) => [m.id, m.label]),
) as Record<ModelId, string>;

export interface FileSummary {
  id: string;
  path: string;
  /** true si `frontmatter.share_external === true` — visible en
   *  /editor/<token>. */
  shared?: boolean;
  /** Campos del frontmatter usados por la vista Índice. Opcionales —
   *  archivos sin estos campos no aparecen en la vista narrativa, solo
   *  en el sidebar tree (orden alfabético por path). */
  title?: string | undefined;
  kind?: string | undefined;
  act?: number | undefined;
  order?: number | undefined;
  voice?: string | undefined;
}

type TreeNode =
  | { type: "file"; file: FileSummary }
  | { type: "folder"; name: string; path: string; children: TreeNode[] };

const NARRATIVE_KINDS = new Set([
  "escena",
  "capitulo",
  "monologo",
  "cierre",
]);

/**
 * Un archivo es "narrativo" si tiene `kind` reconocido como narrativo,
 * o si tiene `act` y `order` definidos en el frontmatter (lo cual
 * implica que el autor lo ubicó en la línea narrativa). Files de
 * meta/canon/manifesto no califican y no aparecen en la vista Índice.
 */
function isNarrativeFile(f: FileSummary): boolean {
  if (f.kind && NARRATIVE_KINDS.has(f.kind)) return true;
  if (f.act !== undefined && f.order !== undefined) return true;
  return false;
}

function narrativeSort(a: FileSummary, b: FileSummary): number {
  const ad = (a.act ?? Number.MAX_SAFE_INTEGER) - (b.act ?? Number.MAX_SAFE_INTEGER);
  if (ad !== 0) return ad;
  const od = (a.order ?? Number.MAX_SAFE_INTEGER) - (b.order ?? Number.MAX_SAFE_INTEGER);
  if (od !== 0) return od;
  return a.path.localeCompare(b.path);
}

/**
 * Construye un árbol de carpetas + archivos a partir de la lista plana de
 * paths del corpus. Carpetas y archivos se ordenan: carpetas primero,
 * después archivos, ambos alfabéticos. Esto da una sidebar tipo VS Code /
 * Obsidian sin inventar metadata extra — todo viene del path.
 */
function buildFileTree(items: FileSummary[]): TreeNode[] {
  const root: TreeNode[] = [];
  const folderMap = new Map<string, TreeNode & { type: "folder" }>();

  for (const f of items) {
    const parts = f.path.split("/").filter((p) => p.length > 0);
    if (parts.length <= 1) {
      root.push({ type: "file", file: f });
      continue;
    }
    const folderParts = parts.slice(0, -1);
    let parent: TreeNode[] = root;
    let acc = "";
    for (const part of folderParts) {
      acc = acc ? `${acc}/${part}` : part;
      let folder = folderMap.get(acc);
      if (!folder) {
        folder = { type: "folder", name: part, path: acc, children: [] };
        folderMap.set(acc, folder);
        parent.push(folder);
      }
      parent = folder.children;
    }
    parent.push({ type: "file", file: f });
  }

  function sort(nodes: TreeNode[]) {
    nodes.sort((a, b) => {
      if (a.type !== b.type) return a.type === "folder" ? -1 : 1;
      const an =
        a.type === "folder" ? a.name : (a.file.path.split("/").pop() ?? "");
      const bn =
        b.type === "folder" ? b.name : (b.file.path.split("/").pop() ?? "");
      return an.localeCompare(bn);
    });
    for (const n of nodes) if (n.type === "folder") sort(n.children);
  }
  sort(root);
  return root;
}

interface InvokeBody {
  fileId: string;
  operation: Operation;
  userPrompt?: string;
  selection?: { text: string; range: { from: number; to: number } };
  cursorPosition?: number;
  model?: ModelId;
}

interface Proposal {
  invocationId: string;
  responseText: string;
  provider: string;
  model: string;
  operation: Operation;
  userPrompt: string;
  status: "proposed" | "reviewing" | "accepted" | "discarded" | "saved";
  // Texto que la propuesta reemplazará. Capturado en el momento de invocar
  // (no se relee del editor en el momento de aceptar) para que el diff sea
  // estable. `null` cuando la operación es `continue` (inserción pura).
  originalText: string | null;
  // Permitimos `undefined` explícito para que los patches puedan limpiar
  // un error previo (exactOptionalPropertyTypes está activo).
  errorDetail?: string | undefined;
}

interface CandidateReviewState {
  originalText: string;
  range: { from: number; to: number } | null;
  cursor: number | null;
}

/**
 * Diff word-level entre el texto original (lo que se va a reemplazar) y la
 * propuesta. Para `continue` el original es `null` y todo el texto cuenta
 * como adición. Renderizamos en serif para que se lea como prosa.
 */
function DiffView({
  original,
  proposed,
}: {
  original: string | null;
  proposed: string;
}) {
  const parts = useMemo(() => {
    if (original === null) {
      return [{ value: proposed, added: true, removed: false }];
    }
    return diffWords(original, proposed).map((p) => ({
      value: p.value,
      added: !!p.added,
      removed: !!p.removed,
    }));
  }, [original, proposed]);
  return (
    <p className="whitespace-pre-wrap font-serif text-sm leading-relaxed text-black">
      {parts.map((p, i) => {
        if (p.added) {
          return (
            <span
              key={i}
              className="bg-emerald-100 text-emerald-900 underline decoration-emerald-400 decoration-1 underline-offset-2"
            >
              {p.value}
            </span>
          );
        }
        if (p.removed) {
          return (
            <span
              key={i}
              className="bg-red-100 text-red-900 line-through decoration-red-400"
            >
              {p.value}
            </span>
          );
        }
        return (
          <span key={i} className="text-neutral-700">
            {p.value}
          </span>
        );
      })}
    </p>
  );
}

interface FileTreeViewProps {
  nodes: TreeNode[];
  depth: number;
  activeId: string | null;
  closedFolders: Set<string>;
  actionMenuFor: string | null;
  renamingFor: string | null;
  renameDraft: string;
  confirmingDeleteFor: string | null;
  editingMetadataFor: string | null;
  metadataDraft: {
    title: string;
    kind: string;
    act: string;
    order: string;
    voice: string;
  };
  actionError: string | null;
  shareEnabled: boolean;
  shareCopiedFor: string | null;
  onToggleFolder: (path: string) => void;
  onSelectFile: (id: string) => void;
  onOpenMenu: (id: string) => void;
  onStartRename: (file: FileSummary) => void;
  onRenameDraftChange: (value: string) => void;
  onCommitRename: (file: FileSummary) => void;
  onCancelRename: () => void;
  onStartDelete: (file: FileSummary) => void;
  onCommitDelete: (file: FileSummary) => void;
  onCancelDelete: () => void;
  onStartEditMetadata: (file: FileSummary) => void;
  onMetadataDraftChange: (
    field: "title" | "kind" | "act" | "order" | "voice",
    value: string,
  ) => void;
  onCommitMetadata: (file: FileSummary) => void;
  onCancelMetadata: () => void;
  onToggleShare: (file: FileSummary) => void;
  onCopyShareLink: (file: FileSummary) => void;
}

/**
 * Render recursivo del árbol del corpus. Folders se renderizan con un
 * caret y son colapsables; los files muestran el filename leaf y un
 * botón "···" que abre un mini-menú con renombrar/eliminar.
 */
function FileTreeView({
  nodes,
  depth,
  activeId,
  closedFolders,
  actionMenuFor,
  renamingFor,
  renameDraft,
  confirmingDeleteFor,
  editingMetadataFor,
  metadataDraft,
  actionError,
  shareEnabled,
  shareCopiedFor,
  onToggleFolder,
  onSelectFile,
  onOpenMenu,
  onStartRename,
  onRenameDraftChange,
  onCommitRename,
  onCancelRename,
  onStartDelete,
  onCommitDelete,
  onCancelDelete,
  onStartEditMetadata,
  onMetadataDraftChange,
  onCommitMetadata,
  onCancelMetadata,
  onToggleShare,
  onCopyShareLink,
}: FileTreeViewProps) {
  return (
    <ul className="space-y-0.5">
      {nodes.map((node) => {
        const indent = { paddingLeft: `${depth * 10 + 4}px` };
        if (node.type === "folder") {
          const closed = closedFolders.has(node.path);
          return (
            <li key={`f:${node.path}`}>
              <button
                type="button"
                onClick={() => onToggleFolder(node.path)}
                style={indent}
                className="block w-full truncate rounded py-1 pr-2 text-left text-neutral-600 hover:bg-neutral-100"
              >
                <span className="mr-1 inline-block w-3 text-[10px] text-neutral-400">
                  {closed ? "▸" : "▾"}
                </span>
                {node.name}/
              </button>
              {!closed && (
                <FileTreeView
                  nodes={node.children}
                  depth={depth + 1}
                  activeId={activeId}
                  closedFolders={closedFolders}
                  actionMenuFor={actionMenuFor}
                  renamingFor={renamingFor}
                  renameDraft={renameDraft}
                  confirmingDeleteFor={confirmingDeleteFor}
                  editingMetadataFor={editingMetadataFor}
                  metadataDraft={metadataDraft}
                  actionError={actionError}
                  shareEnabled={shareEnabled}
                  shareCopiedFor={shareCopiedFor}
                  onToggleFolder={onToggleFolder}
                  onSelectFile={onSelectFile}
                  onOpenMenu={onOpenMenu}
                  onStartRename={onStartRename}
                  onRenameDraftChange={onRenameDraftChange}
                  onCommitRename={onCommitRename}
                  onCancelRename={onCancelRename}
                  onStartDelete={onStartDelete}
                  onCommitDelete={onCommitDelete}
                  onCancelDelete={onCancelDelete}
                  onStartEditMetadata={onStartEditMetadata}
                  onMetadataDraftChange={onMetadataDraftChange}
                  onCommitMetadata={onCommitMetadata}
                  onCancelMetadata={onCancelMetadata}
                  onToggleShare={onToggleShare}
                  onCopyShareLink={onCopyShareLink}
                />
              )}
            </li>
          );
        }
        const f = node.file;
        const filename = f.path.split("/").pop() ?? f.path;
        const isActive = activeId === f.id;
        const menuOpen = actionMenuFor === f.id;
        const isRenaming = renamingFor === f.id;
        const isConfirmingDelete = confirmingDeleteFor === f.id;
        const isEditingMetadata = editingMetadataFor === f.id;
        return (
          <li key={f.id}>
            {isRenaming ? (
              <div className="ml-2 mr-1 mt-1 space-y-1.5 rounded border border-neutral-300 bg-white p-2">
                <p className="text-[11px] uppercase tracking-wide text-neutral-500">
                  Renombrar / mover
                </p>
                <input
                  autoFocus
                  type="text"
                  value={renameDraft}
                  onChange={(e) => onRenameDraftChange(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      e.preventDefault();
                      onCommitRename(f);
                    } else if (e.key === "Escape") {
                      e.preventDefault();
                      onCancelRename();
                    }
                  }}
                  className="w-full rounded border border-neutral-300 px-2 py-1.5 text-xs outline-none focus:border-neutral-500"
                  placeholder="ruta/nuevo_nombre.es.md"
                />
                <div className="flex gap-2">
                  <button
                    type="button"
                    onClick={() => onCommitRename(f)}
                    className="rounded bg-neutral-900 px-2 py-1 text-xs text-white"
                  >
                    guardar
                  </button>
                  <button
                    type="button"
                    onClick={onCancelRename}
                    className="rounded bg-neutral-200 px-2 py-1 text-xs"
                  >
                    cancelar
                  </button>
                </div>
                {actionError && (
                  <p className="text-[11px] text-red-600">
                    error: {actionError}
                  </p>
                )}
              </div>
            ) : isEditingMetadata ? (
              <div className="ml-2 mr-1 mt-1 space-y-2 rounded border border-neutral-300 bg-white p-2">
                <p className="text-[11px] uppercase tracking-wide text-neutral-500">
                  Metadata · {filename}
                </p>
                <div className="space-y-1.5">
                  <label className="block">
                    <span className="text-[11px] text-neutral-500">title</span>
                    <input
                      type="text"
                      value={metadataDraft.title}
                      onChange={(e) =>
                        onMetadataDraftChange("title", e.target.value)
                      }
                      placeholder="título descriptivo (opcional)"
                      className="mt-0.5 w-full rounded border border-neutral-300 px-2 py-1.5 text-xs outline-none focus:border-neutral-500"
                    />
                  </label>
                  <div className="flex gap-2">
                    <label className="flex-1">
                      <span className="text-[11px] text-neutral-500">kind</span>
                      <select
                        value={metadataDraft.kind}
                        onChange={(e) =>
                          onMetadataDraftChange("kind", e.target.value)
                        }
                        className="mt-0.5 w-full rounded border border-neutral-300 bg-white px-2 py-1.5 text-xs outline-none focus:border-neutral-500"
                      >
                        <option value="">—</option>
                        <option value="escena">escena</option>
                        <option value="capitulo">capitulo</option>
                        <option value="monologo">monologo</option>
                        <option value="cierre">cierre</option>
                        <option value="doc">doc</option>
                        <option value="nota">nota</option>
                        <option value="manifest">manifest</option>
                      </select>
                    </label>
                    <label className="w-16">
                      <span className="text-[11px] text-neutral-500">act</span>
                      <input
                        type="number"
                        inputMode="numeric"
                        value={metadataDraft.act}
                        onChange={(e) =>
                          onMetadataDraftChange("act", e.target.value)
                        }
                        className="mt-0.5 w-full rounded border border-neutral-300 px-2 py-1.5 text-xs outline-none focus:border-neutral-500"
                      />
                    </label>
                    <label className="w-16">
                      <span className="text-[11px] text-neutral-500">order</span>
                      <input
                        type="number"
                        inputMode="numeric"
                        value={metadataDraft.order}
                        onChange={(e) =>
                          onMetadataDraftChange("order", e.target.value)
                        }
                        className="mt-0.5 w-full rounded border border-neutral-300 px-2 py-1.5 text-xs outline-none focus:border-neutral-500"
                      />
                    </label>
                  </div>
                  <label className="block">
                    <span className="text-[11px] text-neutral-500">voice</span>
                    <input
                      type="text"
                      value={metadataDraft.voice}
                      onChange={(e) =>
                        onMetadataDraftChange("voice", e.target.value)
                      }
                      placeholder="catalino / marina / olvido / francia / …"
                      className="mt-0.5 w-full rounded border border-neutral-300 px-2 py-1.5 text-xs outline-none focus:border-neutral-500"
                    />
                  </label>
                </div>
                <div className="flex gap-2 pt-1">
                  <button
                    type="button"
                    onClick={() => onCommitMetadata(f)}
                    className="rounded bg-neutral-900 px-2 py-1 text-xs text-white"
                  >
                    guardar
                  </button>
                  <button
                    type="button"
                    onClick={onCancelMetadata}
                    className="rounded bg-neutral-200 px-2 py-1 text-xs"
                  >
                    cancelar
                  </button>
                </div>
                {actionError && (
                  <p className="text-[11px] text-red-600">
                    error: {actionError}
                  </p>
                )}
              </div>
            ) : isConfirmingDelete ? (
              <div className="ml-2 mr-1 mt-1 space-y-1.5 rounded border border-red-300 bg-red-50/50 p-2">
                <p className="text-[11px] text-red-700">
                  Eliminar <span className="font-mono">{filename}</span> y todo
                  lo asociado (versiones, invocaciones, candidatos, chunks).
                  Esto no se puede deshacer.
                </p>
                <div className="flex gap-2">
                  <button
                    type="button"
                    onClick={() => onCommitDelete(f)}
                    className="rounded bg-red-600 px-2 py-1 text-xs text-white"
                  >
                    sí, eliminar
                  </button>
                  <button
                    type="button"
                    onClick={onCancelDelete}
                    className="rounded bg-neutral-200 px-2 py-1 text-xs"
                  >
                    cancelar
                  </button>
                </div>
                {actionError && (
                  <p className="text-[11px] text-red-600">
                    error: {actionError}
                  </p>
                )}
              </div>
            ) : (
              <>
                <div className="group flex items-stretch">
                  <button
                    type="button"
                    onClick={() => onSelectFile(f.id)}
                    style={indent}
                    className={`flex-1 truncate rounded-l py-2 pr-1 text-left md:py-1 ${
                      isActive ? "bg-neutral-200" : "hover:bg-neutral-100"
                    }`}
                  >
                    {filename}
                    {f.shared && (
                      <span
                        className="ml-1.5 inline-block h-1.5 w-1.5 rounded-full bg-emerald-500 align-middle"
                        title="compartido con editor externo"
                      />
                    )}
                  </button>
                  <button
                    type="button"
                    onClick={() => onOpenMenu(f.id)}
                    aria-label="acciones"
                    className={`rounded-r px-2 text-neutral-400 hover:bg-neutral-100 hover:text-neutral-700 ${
                      isActive ? "bg-neutral-200" : ""
                    }`}
                  >
                    ···
                  </button>
                </div>
                {menuOpen && (
                  <div className="ml-2 mt-1 flex flex-wrap gap-2 rounded border border-neutral-200 bg-white p-1.5 shadow-sm">
                    {shareEnabled &&
                      (f.shared ? (
                        <>
                          <button
                            type="button"
                            onClick={() => onCopyShareLink(f)}
                            className="rounded bg-emerald-100 px-2 py-1 text-xs text-emerald-900"
                          >
                            {shareCopiedFor === f.id
                              ? "copiado ✓"
                              : "copiar link"}
                          </button>
                          <button
                            type="button"
                            onClick={() => onToggleShare(f)}
                            className="rounded px-2 py-1 text-xs text-neutral-700 hover:bg-neutral-100"
                          >
                            dejar de compartir
                          </button>
                        </>
                      ) : (
                        <button
                          type="button"
                          onClick={() => onToggleShare(f)}
                          className="rounded px-2 py-1 text-xs text-neutral-700 hover:bg-neutral-100"
                        >
                          compartir con editor
                        </button>
                      ))}
                    <button
                      type="button"
                      onClick={() => onStartEditMetadata(f)}
                      className="rounded px-2 py-1 text-xs text-neutral-700 hover:bg-neutral-100"
                    >
                      metadata
                    </button>
                    <button
                      type="button"
                      onClick={() => onStartRename(f)}
                      className="rounded px-2 py-1 text-xs text-neutral-700 hover:bg-neutral-100"
                    >
                      renombrar
                    </button>
                    <button
                      type="button"
                      onClick={() => onStartDelete(f)}
                      className="rounded px-2 py-1 text-xs text-red-600 hover:bg-red-50"
                    >
                      eliminar
                    </button>
                  </div>
                )}
              </>
            )}
          </li>
        );
      })}
    </ul>
  );
}

interface SavedCandidate {
  candidateId: string;
  invocationId: string;
  operation: string;
  provider: string;
  model: string;
  userPrompt: string;
  responseText: string;
  note: string | null;
  // Cuando el usuario inicia el review de aplicar el candidato, congelamos
  // aquí el texto y la ubicación que se reemplazarán. Si no se cambia
  // durante el review, son los mismos que la selección actual al confirmar.
  review?: CandidateReviewState | undefined;
  errorDetail?: string | undefined;
}

export function Editor({
  files,
  editorToken,
}: {
  files: FileSummary[];
  editorToken: string | null;
}) {
  const [fileList, setFileList] = useState<FileSummary[]>(files);
  const [activeId, setActiveId] = useState<string | null>(
    files[0]?.id ?? null,
  );
  const [creating, setCreating] = useState<boolean>(false);
  const [newPath, setNewPath] = useState<string>("");
  const [createError, setCreateError] = useState<string | null>(null);
  const [creatingLoading, setCreatingLoading] = useState<boolean>(false);
  const [filePath, setFilePath] = useState<string>("");
  // El frontmatter viaja aparte del cuerpo: Tiptap lo destruiría al
  // reserializarlo (ver src/lib/corpus/frontmatter.ts). Se guarda literal
  // y se vuelve a pegar en cada save.
  const [frontmatterBlock, setFrontmatterBlock] = useState<string>("");
  const [content, setContent] = useState<string>("");
  const [operation, setOperation] = useState<Operation>("free_prompt");
  const [model, setModel] = useState<ModelId>(MODELS[0].id);
  const [userPrompt, setUserPrompt] = useState<string>("");
  const [proposals, setProposals] = useState<Proposal[]>([]);
  const [savedCandidates, setSavedCandidates] = useState<SavedCandidate[]>([]);
  const [loading, setLoading] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);
  const [sel, setSel] = useState<{ start: number; end: number }>({
    start: 0,
    end: 0,
  });
  const [lastSavedContent, setLastSavedContent] = useState<string>("");
  const [saveState, setSaveState] = useState<SaveState>("guardado");
  const saveTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Layout móvil: archivos como drawer izquierdo, propuestas como bottom-sheet.
  // En desktop ambos están siempre visibles y estos flags no aplican.
  const [mobileFilesOpen, setMobileFilesOpen] = useState<boolean>(false);
  const [mobileSheetOpen, setMobileSheetOpen] = useState<boolean>(false);
  const lastProposalsCountRef = useRef<number>(0);

  // Reindex manual del corpus para RAG. Por ahora se dispara desde el
  // sidebar de archivos. Cuando agreguemos auto-reindex en save este
  // botón puede quedar como fallback.
  const [reindexing, setReindexing] = useState<boolean>(false);
  const [reindexStatus, setReindexStatus] = useState<string | null>(null);

  // Backups: ZIP descargable y sync inicial bulk a GitHub.
  const [syncingGitHub, setSyncingGitHub] = useState<boolean>(false);
  const [syncStatus, setSyncStatus] = useState<string | null>(null);

  function handleExportZip() {
    window.open("/api/admin/export-corpus", "_blank");
  }

  async function handleSyncGitHub() {
    if (syncingGitHub) return;
    setSyncingGitHub(true);
    setSyncStatus(null);
    try {
      const res = await fetch("/api/admin/sync-github", { method: "POST" });
      const data = (await res.json()) as Record<string, unknown>;
      if (!res.ok) {
        const err = typeof data.error === "string" ? data.error : "fallo";
        const detail =
          typeof data.detail === "string" ? `: ${data.detail}` : "";
        setSyncStatus(`error: ${err}${detail}`);
        return;
      }
      const pushed = Number(data.pushed ?? 0);
      const total = Number(data.total ?? 0);
      const errored = Number(data.errored ?? 0);
      setSyncStatus(
        `github: ${pushed}/${total} empujados${errored > 0 ? ` · ${errored} errores` : ""}`,
      );
    } catch {
      setSyncStatus("error: red");
    } finally {
      setSyncingGitHub(false);
    }
  }

  // Upload de .md ya existentes desde el dispositivo. El file picker móvil
  // no preserva carpetas, así que el path del archivo subido es solo el
  // filename (con `.es.` agregado si la convención no se cumple).
  const [uploading, setUploading] = useState<boolean>(false);
  const [uploadStatus, setUploadStatus] = useState<string | null>(null);
  const uploadInputRef = useRef<HTMLInputElement | null>(null);

  // Sidebar tiene dos vistas: tree (por carpeta, alfabético) e índice
  // (por act + order, narrativo). Tree es la default — incluye TODO el
  // corpus. Índice solo muestra archivos narrativos.
  const [sidebarView, setSidebarView] = useState<"tree" | "indice">("tree");

  // Vista de árbol del sidebar. `closedFolders` rastrea carpetas que el
  // usuario colapsó explícitamente; el resto está abierto por default
  // para que ningún archivo quede oculto sin querer.
  const [closedFolders, setClosedFolders] = useState<Set<string>>(new Set());
  const [actionMenuFor, setActionMenuFor] = useState<string | null>(null);
  // UI inline para renombrar / confirmar eliminación. Reemplazo de
  // window.prompt() / window.confirm() que son rústicos y a veces
  // bloqueados en navegadores móviles.
  const [renamingFor, setRenamingFor] = useState<string | null>(null);
  const [renameDraft, setRenameDraft] = useState<string>("");
  const [confirmingDeleteFor, setConfirmingDeleteFor] = useState<string | null>(
    null,
  );
  const [editingMetadataFor, setEditingMetadataFor] = useState<string | null>(
    null,
  );
  const [metadataDraft, setMetadataDraft] = useState<{
    title: string;
    kind: string;
    act: string;
    order: string;
    voice: string;
  }>({ title: "", kind: "", act: "", order: "", voice: "" });
  const [actionError, setActionError] = useState<string | null>(null);
  const fileTree = useMemo(() => buildFileTree(fileList), [fileList]);

  // Lista narrativa ordenada — usada para mostrar el índice y para
  // calcular "anterior / siguiente" cuando estás dentro de una escena.
  const narrativeOrdered = useMemo(
    () => fileList.filter(isNarrativeFile).sort(narrativeSort),
    [fileList],
  );
  const narrativeIndex = useMemo(() => {
    if (!activeId) return -1;
    return narrativeOrdered.findIndex((f) => f.id === activeId);
  }, [narrativeOrdered, activeId]);
  const prevNarrative =
    narrativeIndex > 0 ? narrativeOrdered[narrativeIndex - 1] : null;
  const nextNarrative =
    narrativeIndex >= 0 && narrativeIndex < narrativeOrdered.length - 1
      ? narrativeOrdered[narrativeIndex + 1]
      : null;

  function toggleFolder(path: string) {
    setClosedFolders((s) => {
      const next = new Set(s);
      if (next.has(path)) next.delete(path);
      else next.add(path);
      return next;
    });
  }

  function startRename(file: FileSummary) {
    setActionMenuFor(null);
    setConfirmingDeleteFor(null);
    setActionError(null);
    setRenameDraft(file.path);
    setRenamingFor(file.id);
  }

  function cancelRename() {
    setRenamingFor(null);
    setRenameDraft("");
    setActionError(null);
  }

  async function commitRename(file: FileSummary) {
    const next = renameDraft.trim();
    if (!next) {
      setActionError("path vacío");
      return;
    }
    if (next === file.path) {
      cancelRename();
      return;
    }
    setActionError(null);
    try {
      const res = await fetch(`/api/files/${file.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ path: next }),
      });
      const data = (await res.json()) as Record<string, unknown>;
      if (!res.ok) {
        const err = typeof data.error === "string" ? data.error : "error";
        const detail =
          typeof data.detail === "string" ? `: ${data.detail}` : "";
        setActionError(`${err}${detail}`);
        return;
      }
      const newPath = String(data.path);
      setFileList((prev) =>
        prev
          .map((f) => (f.id === file.id ? { ...f, path: newPath } : f))
          .sort((a, b) => a.path.localeCompare(b.path)),
      );
      if (file.id === activeId) setFilePath(newPath);
      cancelRename();
    } catch {
      setActionError("red");
    }
  }

  function startEditMetadata(file: FileSummary) {
    setActionMenuFor(null);
    setRenamingFor(null);
    setConfirmingDeleteFor(null);
    setActionError(null);
    setMetadataDraft({
      title: file.title ?? "",
      kind: file.kind ?? "",
      act: file.act !== undefined ? String(file.act) : "",
      order: file.order !== undefined ? String(file.order) : "",
      voice: file.voice ?? "",
    });
    setEditingMetadataFor(file.id);
  }

  function cancelMetadata() {
    setEditingMetadataFor(null);
    setMetadataDraft({ title: "", kind: "", act: "", order: "", voice: "" });
    setActionError(null);
  }

  async function commitMetadata(file: FileSummary) {
    setActionError(null);
    // Construir el body solo con campos no vacíos. El que está vacío en
    // el form NO se envía — preserva el valor que ya estaba en DB.
    const body: Record<string, unknown> = {};
    const t = metadataDraft.title.trim();
    const k = metadataDraft.kind.trim();
    const v = metadataDraft.voice.trim();
    if (t !== "") body.title = t;
    if (k !== "") body.kind = k;
    if (v !== "") body.voice = v;
    if (metadataDraft.act.trim() !== "") {
      const n = Number(metadataDraft.act);
      if (Number.isFinite(n) && Number.isInteger(n)) body.act = n;
    }
    if (metadataDraft.order.trim() !== "") {
      const n = Number(metadataDraft.order);
      if (Number.isFinite(n) && Number.isInteger(n)) body.order = n;
    }
    if (Object.keys(body).length === 0) {
      cancelMetadata();
      return;
    }
    try {
      const res = await fetch(`/api/files/${file.id}/frontmatter`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = (await res.json()) as Record<string, unknown>;
      if (!res.ok) {
        const err = typeof data.error === "string" ? data.error : "error";
        setActionError(err);
        return;
      }
      // Actualizar fileList: si hubo shift de otros archivos (cambio de
      // order/act), recargar la lista entera para que la vista Índice
      // se reordene con el estado real de la DB. Para ediciones que solo
      // cambian title/kind/voice (sin shift), un patch local alcanza.
      const shifted = Number(data.shiftedCount ?? 0);
      if (shifted > 0) {
        try {
          const r = await fetch("/api/files");
          const fd = (await r.json()) as { files?: FileSummary[] };
          if (r.ok && fd.files) setFileList(fd.files);
        } catch {
          // Fallback: patch local solo del editado.
          patchLocal();
        }
      } else {
        patchLocal();
      }
      cancelMetadata();
    } catch {
      setActionError("red");
    }

    function patchLocal() {
      setFileList((prev) =>
        prev.map((f) =>
          f.id === file.id
            ? {
                ...f,
                title: typeof body.title === "string" ? body.title : f.title,
                kind: typeof body.kind === "string" ? body.kind : f.kind,
                act:
                  typeof body.act === "number"
                    ? body.act
                    : f.act,
                order:
                  typeof body.order === "number"
                    ? body.order
                    : f.order,
                voice: typeof body.voice === "string" ? body.voice : f.voice,
              }
            : f,
        ),
      );
    }
  }

  function startDelete(file: FileSummary) {
    setActionMenuFor(null);
    setRenamingFor(null);
    setActionError(null);
    setConfirmingDeleteFor(file.id);
  }

  function cancelDelete() {
    setConfirmingDeleteFor(null);
    setActionError(null);
  }

  async function commitDelete(file: FileSummary) {
    setActionError(null);
    try {
      const res = await fetch(`/api/files/${file.id}`, { method: "DELETE" });
      if (!res.ok) {
        setActionError("no se pudo eliminar");
        return;
      }
      setFileList((prev) => prev.filter((f) => f.id !== file.id));
      if (file.id === activeId) {
        setActiveId(null);
        setContent("");
        setFilePath("");
      }
      setConfirmingDeleteFor(null);
    } catch {
      setActionError("red");
    }
  }

  function normalizeUploadPath(filename: string): string {
    if (/^.+\.[a-z]{2}\.[a-z0-9]+$/i.test(filename)) return filename;
    const m = /^(.+)\.([a-z0-9]+)$/i.exec(filename);
    if (m) return `${m[1] as string}.es.${m[2] as string}`;
    return `${filename}.es.md`;
  }

  async function handleUploadFiles(fileList: FileList | null) {
    if (!fileList || fileList.length === 0) return;
    setUploading(true);
    setUploadStatus(null);
    let created = 0;
    let conflict = 0;
    let errored = 0;
    const newRows: FileSummary[] = [];
    for (const f of Array.from(fileList)) {
      try {
        const content = await f.text();
        const path = normalizeUploadPath(f.name);
        const res = await fetch("/api/files", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ path, content, corpusLayer: "production" }),
        });
        if (res.status === 409) {
          conflict += 1;
          continue;
        }
        if (!res.ok) {
          errored += 1;
          continue;
        }
        const data = (await res.json()) as { id?: string; path?: string };
        if (data.id && data.path) {
          newRows.push({ id: data.id, path: data.path });
          created += 1;
        }
      } catch {
        errored += 1;
      }
    }
    if (newRows.length > 0) {
      setFileList((prev) =>
        [...prev, ...newRows].sort((a, b) => a.path.localeCompare(b.path)),
      );
    }
    const parts: string[] = [`${created} subidos`];
    if (conflict > 0) parts.push(`${conflict} ya existían`);
    if (errored > 0) parts.push(`${errored} fallaron`);
    setUploadStatus(parts.join(" · "));
    setUploading(false);
    if (uploadInputRef.current) uploadInputRef.current.value = "";
  }

  function handleDownloadActive() {
    if (!activeId) return;
    // Nuevo tab evita perder el state del editor; el browser detecta el
    // Content-Disposition: attachment y descarga sin abrir nada visible.
    window.open(`/api/files/${activeId}/download`, "_blank");
  }

  // Historial de versiones del archivo activo: panel modal accesible
  // desde el header del editor.
  const [historyOpen, setHistoryOpen] = useState<boolean>(false);

  /**
   * Carga contenido crudo del servidor en el editor. El frontmatter se
   * aparta antes de tocar Tiptap: si entra al documento, Markdown lo lee
   * como regla horizontal + encabezado setext y el siguiente guardado lo
   * escribe destruido. Todo lo que venga del servidor pasa por aquí.
   */
  const loadRawContent = useCallback((raw: string) => {
    const { frontmatter, body } = splitFrontmatter(raw);
    setFrontmatterBlock(frontmatter);
    setContent(body);
    setLastSavedContent(body);
    setSaveState("guardado");
  }, []);

  function handleVersionRestored(restoredContent: string) {
    loadRawContent(restoredContent);
    setHistoryOpen(false);
  }

  // Comentarios anclados al texto. Los carga el archivo activo y se
  // mantiene la lista en estado para que la extensión de Tiptap pueda
  // dibujar decoraciones consistentes con el panel.
  const [commentsOpen, setCommentsOpen] = useState<boolean>(false);
  const [activeComments, setActiveComments] = useState<Comment[]>([]);
  const [scrollToAnchor, setScrollToAnchor] = useState<{
    id: string;
    quote: string;
    prefix: string;
    suffix: string;
  } | null>(null);
  const [selectionPrefix, setSelectionPrefix] = useState<string>("");
  const [selectionSuffix, setSelectionSuffix] = useState<string>("");
  const [selectionText, setSelectionText] = useState<string>("");

  // Anchors derivados para la extensión: solo los activos (no resueltos).
  const commentAnchors = useMemo<CommentAnchor[]>(
    () =>
      activeComments
        .filter((c) => c.resolvedAt === null)
        .map((c) => ({
          id: c.id,
          quote: c.anchorQuote,
          prefix: c.anchorPrefix,
          suffix: c.anchorSuffix,
        })),
    [activeComments],
  );

  // Cargar los comentarios del archivo activo cuando cambia. Sin abrir
  // el panel — los necesitamos para las decoraciones.
  useEffect(() => {
    if (!activeId) {
      setActiveComments([]);
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`/api/files/${activeId}/comments?all=1`);
        const data = (await res.json()) as { comments?: Comment[] };
        if (!cancelled && res.ok) {
          setActiveComments(data.comments ?? []);
        }
      } catch {
        if (!cancelled) setActiveComments([]);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [activeId]);

  function handleJumpToComment(c: Comment) {
    setScrollToAnchor({
      id: c.id,
      quote: c.anchorQuote,
      prefix: c.anchorPrefix,
      suffix: c.anchorSuffix,
    });
    setCommentsOpen(false);
    // Reset después del frame para que el efecto se dispare incluso si
    // el mismo anchor se clickea dos veces seguidas.
    setTimeout(() => setScrollToAnchor(null), 100);
  }

  function handleCommentAnchorClick(commentId: string) {
    // Click sobre un highlight en el editor: abrir el panel y resaltar
    // el comentario correspondiente. Para v1 solo abrimos el panel; el
    // user encuentra el comentario en la lista.
    void commentId;
    setCommentsOpen(true);
  }

  // Compartir vía /editor/<token>: escribe el flag share_external en el
  // frontmatter del archivo. Estado se refleja en `fileList[i].shared`,
  // que es la fuente de verdad — la UI lo lee desde ahí.
  const [shareCopiedFor, setShareCopiedFor] = useState<string | null>(null);

  async function handleToggleShare(file: FileSummary) {
    setActionMenuFor(null);
    const next = !file.shared;
    // Optimistic — actualizar UI primero, rollback si el server falla.
    setFileList((prev) =>
      prev.map((f) => (f.id === file.id ? { ...f, shared: next } : f)),
    );
    try {
      const res = await fetch(`/api/files/${file.id}/share`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ share: next }),
      });
      if (!res.ok) {
        setFileList((prev) =>
          prev.map((f) => (f.id === file.id ? { ...f, shared: !next } : f)),
        );
      }
    } catch {
      setFileList((prev) =>
        prev.map((f) => (f.id === file.id ? { ...f, shared: !next } : f)),
      );
    }
  }

  async function handleCopyShareLink(file: FileSummary) {
    setActionMenuFor(null);
    if (!editorToken) return;
    const url = `${window.location.origin}/editor/${editorToken}/${file.id}`;
    try {
      await navigator.clipboard.writeText(url);
      setShareCopiedFor(file.id);
      setTimeout(() => setShareCopiedFor(null), 2000);
    } catch {
      // navigator.clipboard puede fallar en contextos no-seguros;
      // fallback: prompt nativo (poco bonito pero funcional).
      window.prompt("Copia el link del editor:", url);
    }
  }

  async function handleReindex() {
    if (reindexing) return;
    setReindexing(true);
    setReindexStatus(null);
    try {
      const res = await fetch("/api/admin/reindex", { method: "POST" });
      const data = (await res.json()) as Record<string, unknown>;
      if (!res.ok) {
        const err = typeof data.error === "string" ? data.error : "fallo";
        const detail =
          typeof data.detail === "string" ? `: ${data.detail}` : "";
        setReindexStatus(`error: ${err}${detail}`);
      } else {
        const files = Number(data.filesIndexed ?? 0);
        const total = Number(data.totalChunks ?? 0);
        setReindexStatus(`${files} archivos · ${total} chunks`);
      }
    } catch {
      setReindexStatus("error: red");
    } finally {
      setReindexing(false);
    }
  }

  function handleSelectionChange(info: MarkdownSelectionInfo) {
    if (info.selection) {
      setSel({ start: info.selection.from, end: info.selection.to });
      setSelectionText(info.selection.text);
      setSelectionPrefix(info.selection.prefix);
      setSelectionSuffix(info.selection.suffix);
    } else {
      setSel({ start: info.cursor, end: info.cursor });
      setSelectionText("");
      setSelectionPrefix("");
      setSelectionSuffix("");
    }
  }

  function clearSelection() {
    setSel({ start: sel.start, end: sel.start });
  }

  useEffect(() => {
    if (!activeId) {
      setContent("");
      setLastSavedContent("");
      setSaveState("guardado");
      setFilePath("");
      setProposals([]);
      setSavedCandidates([]);
      setShareCopiedFor(null);
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        const [fileRes, candRes] = await Promise.all([
          fetch(`/api/files/${activeId}`),
          fetch(`/api/files/${activeId}/candidates`),
        ]);
        const fileData = (await fileRes.json()) as {
          content?: string;
          path?: string;
          frontmatter?: Record<string, unknown>;
        };
        const candData = (await candRes.json()) as {
          candidates?: SavedCandidate[];
        };
        if (cancelled) return;
        if (fileRes.ok) {
          loadRawContent(fileData.content ?? "");
          setFilePath(fileData.path ?? "");
          // Sincronizar el flag shared en fileList por si cambió desde
          // otra sesión / cliente.
          const sharedNow = fileData.frontmatter?.share_external === true;
          setFileList((prev) =>
            prev.map((f) =>
              f.id === activeId ? { ...f, shared: sharedNow } : f,
            ),
          );
        }
        setProposals([]);
        setSavedCandidates(candRes.ok ? (candData.candidates ?? []) : []);
      } catch {
        if (!cancelled) setError("no se pudo cargar el archivo");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [activeId, loadRawContent]);

  /**
   * Auto-save granular: cuando el contenido difiere de lo último guardado,
   * arrancamos un debounce de AUTOSAVE_DEBOUNCE_MS. Cualquier nuevo cambio
   * dentro de la ventana reinicia el timer; en el silencio, dispara el POST.
   */
  useEffect(() => {
    if (!activeId) return;
    if (content === lastSavedContent) {
      setSaveState("guardado");
      return;
    }
    setSaveState("sin_guardar");
    if (saveTimeoutRef.current) clearTimeout(saveTimeoutRef.current);
    const fileId = activeId;
    const snapshot = content;
    saveTimeoutRef.current = setTimeout(async () => {
      setSaveState("guardando");
      try {
        const res = await fetch(`/api/files/${fileId}/save`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            content: joinFrontmatter(frontmatterBlock, snapshot),
          }),
        });
        if (!res.ok) {
          setSaveState("error");
          return;
        }
        setLastSavedContent(snapshot);
        setSaveState("guardado");
      } catch {
        setSaveState("error");
      }
    }, AUTOSAVE_DEBOUNCE_MS);
    return () => {
      if (saveTimeoutRef.current) {
        clearTimeout(saveTimeoutRef.current);
        saveTimeoutRef.current = null;
      }
    };
  }, [content, activeId, lastSavedContent, frontmatterBlock]);

  // Cuando aparece una propuesta nueva, abrir la sheet en móvil para que
  // se vea sin tener que ir a buscarla. En desktop el flag es inocuo.
  useEffect(() => {
    if (proposals.length > lastProposalsCountRef.current) {
      setMobileSheetOpen(true);
    }
    lastProposalsCountRef.current = proposals.length;
  }, [proposals.length]);

  /**
   * Forza un guardado inmediato del estado pendiente. Lo llamamos antes de
   * accept/apply para que el endpoint opere sobre la última edición y no
   * sobre la versión vieja en DB.
   */
  async function flushPendingSave(): Promise<void> {
    if (!activeId) return;
    if (content === lastSavedContent) return;
    if (saveTimeoutRef.current) {
      clearTimeout(saveTimeoutRef.current);
      saveTimeoutRef.current = null;
    }
    setSaveState("guardando");
    const snapshot = content;
    try {
      const res = await fetch(`/api/files/${activeId}/save`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ content: snapshot }),
      });
      if (res.ok) {
        setLastSavedContent(snapshot);
        setSaveState("guardado");
      } else {
        setSaveState("error");
      }
    } catch {
      setSaveState("error");
    }
  }

  function getLocation() {
    if (sel.start !== sel.end) {
      return {
        selection: {
          text: content.slice(sel.start, sel.end),
          range: { from: sel.start, to: sel.end },
        },
        cursorPosition: sel.start,
      };
    }
    return { selection: null, cursorPosition: sel.start };
  }

  async function handleInvoke(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!activeId) return;
    const loc = getLocation();
    setLoading(true);
    setError(null);
    try {
      const trimmed = userPrompt.trim();
      const body: InvokeBody = {
        fileId: activeId,
        operation,
        model,
        ...(trimmed !== "" && { userPrompt: trimmed }),
        ...(loc.selection
          ? { selection: loc.selection }
          : { cursorPosition: loc.cursorPosition }),
      };
      const res = await fetch("/api/invoke", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      let data: Record<string, unknown>;
      try {
        data = (await res.json()) as Record<string, unknown>;
      } catch {
        setError(
          `${res.status} ${res.statusText || "error"} (respuesta no fue JSON)`,
        );
        return;
      }
      if (!res.ok) {
        const err = typeof data.error === "string" ? data.error : "error";
        const detail = typeof data.detail === "string" ? `: ${data.detail}` : "";
        setError(`${err}${detail}`);
        return;
      }
      setProposals((prev) => [
        {
          invocationId: String(data.invocationId),
          responseText: String(data.responseText),
          provider: String(data.provider),
          model: String(data.model),
          operation,
          userPrompt: trimmed,
          status: "proposed",
          originalText: loc.selection ? loc.selection.text : null,
        },
        ...prev,
      ]);
    } catch {
      setError("la invocación falló (red o servidor)");
    } finally {
      setLoading(false);
    }
  }

  function patchProposal(invId: string, patch: Partial<Proposal>) {
    setProposals((prev) =>
      prev.map((p) => (p.invocationId === invId ? { ...p, ...patch } : p)),
    );
  }

  function handleAccept(invId: string) {
    // No aplica todavía: pasa al estado "reviewing" donde se muestra el
    // diff y el usuario confirma o cancela.
    patchProposal(invId, { status: "reviewing", errorDetail: undefined });
  }

  function handleCancelReview(invId: string) {
    patchProposal(invId, { status: "proposed", errorDetail: undefined });
  }

  async function handleConfirmAccept(invId: string) {
    await flushPendingSave();
    try {
      const res = await fetch(`/api/invocations/${invId}/accept`, {
        method: "POST",
      });
      const data = (await res.json()) as Record<string, unknown>;
      if (!res.ok) {
        patchProposal(invId, {
          errorDetail: typeof data.error === "string" ? data.error : "error",
          status: "proposed",
        });
        return;
      }
      loadRawContent(String(data.content));
      patchProposal(invId, { status: "accepted" });
      setMobileSheetOpen(false);
    } catch {
      patchProposal(invId, { errorDetail: "red", status: "proposed" });
    }
  }

  async function handleDiscard(invId: string) {
    try {
      const res = await fetch(`/api/invocations/${invId}/discard`, {
        method: "POST",
      });
      if (res.ok) patchProposal(invId, { status: "discarded" });
    } catch {
      patchProposal(invId, { errorDetail: "red" });
    }
  }

  async function handleSave(invId: string) {
    const prop = proposals.find((p) => p.invocationId === invId);
    if (!prop) return;
    try {
      const res = await fetch(`/api/invocations/${invId}/save-as-candidate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });
      const data = (await res.json()) as Record<string, unknown>;
      if (!res.ok) {
        patchProposal(invId, {
          errorDetail: typeof data.error === "string" ? data.error : "error",
        });
        return;
      }
      // Mueve la propuesta a la sección persistente para que el usuario vea
      // claramente que se "trasladó" a candidatos guardados.
      setSavedCandidates((prev) => [
        ...prev,
        {
          candidateId: String(data.candidateId),
          invocationId: invId,
          operation: prop.operation,
          provider: prop.provider,
          model: prop.model,
          userPrompt: prop.userPrompt,
          responseText: prop.responseText,
          note: null,
        },
      ]);
      setProposals((prev) => prev.filter((p) => p.invocationId !== invId));
    } catch {
      patchProposal(invId, { errorDetail: "red" });
    }
  }

  function patchCandidate(candId: string, patch: Partial<SavedCandidate>) {
    setSavedCandidates((prev) =>
      prev.map((c) => (c.candidateId === candId ? { ...c, ...patch } : c)),
    );
  }

  function handleApplyCandidate(candId: string) {
    // Congelamos la ubicación y el texto a reemplazar al entrar en review,
    // para que la vista de diff no cambie si el cursor se mueve después.
    const review: CandidateReviewState =
      sel.start !== sel.end
        ? {
            originalText: content.slice(sel.start, sel.end),
            range: { from: sel.start, to: sel.end },
            cursor: null,
          }
        : {
            originalText: "",
            range: null,
            cursor: sel.start,
          };
    patchCandidate(candId, { review, errorDetail: undefined });
  }

  function handleCancelCandidateReview(candId: string) {
    setSavedCandidates((prev) =>
      prev.map((c) => {
        if (c.candidateId !== candId) return c;
        const { review: _r, errorDetail: _e, ...rest } = c;
        void _r;
        void _e;
        return rest;
      }),
    );
  }

  async function handleConfirmApplyCandidate(candId: string) {
    if (!activeId) return;
    const cand = savedCandidates.find((c) => c.candidateId === candId);
    if (!cand?.review) return;
    await flushPendingSave();
    const body = cand.review.range
      ? { selection: { range: cand.review.range } }
      : { cursorPosition: cand.review.cursor ?? 0 };
    try {
      const res = await fetch(`/api/candidates/${candId}/apply`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = (await res.json()) as Record<string, unknown>;
      if (!res.ok) {
        patchCandidate(candId, {
          errorDetail: typeof data.error === "string" ? data.error : "error",
          review: undefined,
        });
        return;
      }
      loadRawContent(String(data.content));
      // Limpiamos review y cualquier error previo del candidato.
      setSavedCandidates((prev) =>
        prev.map((c) => {
          if (c.candidateId !== candId) return c;
          const { review: _r, errorDetail: _e, ...rest } = c;
          void _r;
          void _e;
          return rest;
        }),
      );
      setMobileSheetOpen(false);
    } catch {
      patchCandidate(candId, { errorDetail: "red", review: undefined });
    }
  }

  async function handleDeleteCandidate(candId: string) {
    try {
      const res = await fetch(`/api/candidates/${candId}`, {
        method: "DELETE",
      });
      if (res.ok) {
        setSavedCandidates((prev) =>
          prev.filter((c) => c.candidateId !== candId),
        );
      }
    } catch {
      patchCandidate(candId, { errorDetail: "red" });
    }
  }

  async function handleCreate(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const p = newPath.trim();
    if (!p) return;
    setCreatingLoading(true);
    setCreateError(null);
    try {
      const res = await fetch("/api/files", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          path: p,
          content: "",
          corpusLayer: "production",
        }),
      });
      const data = (await res.json()) as Record<string, unknown>;
      if (!res.ok) {
        const err =
          typeof data.error === "string" ? data.error : "no se pudo crear";
        const detail = typeof data.detail === "string" ? data.detail : null;
        setCreateError(detail ? `${err} — ${detail}` : err);
        return;
      }
      const created: FileSummary = {
        id: String(data.id),
        path: String(data.path),
      };
      setFileList((prev) =>
        [...prev, created].sort((a, b) => a.path.localeCompare(b.path)),
      );
      setNewPath("");
      setCreating(false);
      setActiveId(created.id);
      setMobileFilesOpen(false);
    } catch {
      setCreateError("red");
    } finally {
      setCreatingLoading(false);
    }
  }

  function selectFile(id: string) {
    setActiveId(id);
    setMobileFilesOpen(false);
  }

  const pendingCount = proposals.filter((p) => p.status === "proposed").length;
  const badgeCount = pendingCount + savedCandidates.length;

  // Conteo de palabras del archivo activo. `\S+` cuenta cualquier
  // secuencia de no-whitespace como una palabra. Computado desde el
  // markdown crudo, así que markup como `**` o `_` cuenta como parte
  // de la palabra (correcto para una métrica de "cuánto escribí").
  const wordCount = useMemo(() => {
    if (!content) return 0;
    const matches = content.match(/\S+/g);
    return matches ? matches.length : 0;
  }, [content]);

  const saveStatus = (
    <span
      className={
        saveState === "error"
          ? "text-red-600"
          : saveState === "sin_guardar"
            ? "text-amber-600"
            : saveState === "guardando"
              ? "text-neutral-500"
              : "text-neutral-400"
      }
    >
      {saveState === "guardado" && "guardado"}
      {saveState === "guardando" && "guardando…"}
      {saveState === "sin_guardar" && "sin guardar"}
      {saveState === "error" && "error al guardar"}
    </span>
  );

  return (
    <main className="flex h-[100dvh] flex-col text-sm md:grid md:h-screen md:grid-cols-[200px_1fr_360px] md:divide-x md:divide-neutral-200">
      {/* Top bar móvil. Hidden en desktop. */}
      <header className="flex items-center gap-2 border-b border-neutral-200 bg-white px-3 py-2 md:hidden">
        <button
          type="button"
          onClick={() => setMobileFilesOpen(true)}
          aria-label="abrir archivos"
          className="-ml-1 flex h-9 w-9 items-center justify-center rounded text-lg text-neutral-700 hover:bg-neutral-100"
        >
          ☰
        </button>
        <span className="flex-1 truncate font-mono text-xs text-neutral-600">
          {filePath || "—"}
        </span>
        <span className="hidden text-[10px] text-neutral-400 sm:inline">
          {wordCount.toLocaleString("es-ES")} pal
        </span>
        <span className="text-[11px]">{saveStatus}</span>
        <button
          type="button"
          onClick={() => setCommentsOpen(true)}
          disabled={!activeId}
          aria-label="comentarios"
          title="comentarios anclados"
          className="relative flex h-9 min-w-[36px] items-center justify-center rounded px-2 text-[11px] text-neutral-700 hover:bg-neutral-100 disabled:opacity-40"
        >
          com
          {activeComments.filter((c) => c.resolvedAt === null).length > 0 && (
            <span className="absolute -right-0.5 -top-0.5 flex h-4 min-w-[16px] items-center justify-center rounded-full bg-amber-500 px-1 text-[10px] font-medium text-white">
              {activeComments.filter((c) => c.resolvedAt === null).length}
            </span>
          )}
        </button>
        <OverflowMenu
          ariaLabel="más acciones del archivo"
          buttonClassName="flex h-9 w-9 items-center justify-center rounded text-base text-neutral-700 hover:bg-neutral-100"
          items={[
            {
              label: "historial de versiones",
              onClick: () => setHistoryOpen(true),
              disabled: !activeId,
            },
            {
              label: "descargar como .md",
              onClick: handleDownloadActive,
              disabled: !activeId,
            },
          ]}
        />
        <button
          type="button"
          onClick={() => setMobileSheetOpen(true)}
          aria-label="abrir propuestas"
          className="relative -mr-1 flex h-9 w-9 items-center justify-center rounded text-lg text-neutral-700 hover:bg-neutral-100"
        >
          ✎
          {badgeCount > 0 && (
            <span className="absolute -right-0.5 -top-0.5 flex h-4 min-w-[16px] items-center justify-center rounded-full bg-amber-500 px-1 text-[10px] font-medium text-white">
              {badgeCount}
            </span>
          )}
        </button>
      </header>

      {/* Backdrop del drawer de archivos (solo móvil) */}
      {mobileFilesOpen && (
        <div
          onClick={() => setMobileFilesOpen(false)}
          className="fixed inset-0 z-40 bg-black/30 md:hidden"
          aria-hidden
        />
      )}

      {/* Files panel: drawer en móvil, columna 1 en desktop */}
      <aside
        className={`fixed inset-y-0 left-0 z-50 w-[280px] transform overflow-y-auto bg-white p-3 shadow-xl transition-transform duration-200 md:static md:z-auto md:w-auto md:transform-none md:shadow-none md:transition-none ${
          mobileFilesOpen ? "translate-x-0" : "-translate-x-full"
        } md:translate-x-0`}
      >
        <div className="mb-2 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <h2 className="text-xs font-semibold uppercase tracking-wide text-neutral-500">
              {sidebarView === "tree" ? "Archivos" : "Índice"}
            </h2>
            <div className="flex items-center text-[10px] uppercase tracking-wide">
              <button
                type="button"
                onClick={() => setSidebarView("tree")}
                className={`rounded-l border px-1.5 py-0.5 ${
                  sidebarView === "tree"
                    ? "border-neutral-300 bg-neutral-100 text-neutral-800"
                    : "border-neutral-200 text-neutral-400 hover:text-neutral-700"
                }`}
              >
                tree
              </button>
              <button
                type="button"
                onClick={() => setSidebarView("indice")}
                className={`-ml-px rounded-r border px-1.5 py-0.5 ${
                  sidebarView === "indice"
                    ? "border-neutral-300 bg-neutral-100 text-neutral-800"
                    : "border-neutral-200 text-neutral-400 hover:text-neutral-700"
                }`}
              >
                índice
              </button>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => {
                setCreating((v) => !v);
                setCreateError(null);
              }}
              className="text-xs text-neutral-500 hover:text-neutral-900"
            >
              {creating ? "cancelar" : "+ nuevo"}
            </button>
            <OverflowMenu
              ariaLabel="más acciones del corpus"
              items={[
                {
                  label: uploading ? "subiendo…" : "subir archivos .md",
                  onClick: () => uploadInputRef.current?.click(),
                  disabled: uploading,
                },
                {
                  label: reindexing ? "reindexando…" : "reindexar corpus",
                  onClick: handleReindex,
                  disabled: reindexing,
                },
                {
                  label: "exportar como ZIP",
                  onClick: handleExportZip,
                },
                {
                  label: syncingGitHub ? "syncing…" : "sync inicial GitHub",
                  onClick: handleSyncGitHub,
                  disabled: syncingGitHub,
                },
              ]}
            />
            <button
              type="button"
              onClick={() => setMobileFilesOpen(false)}
              aria-label="cerrar archivos"
              className="-mr-1 text-neutral-500 hover:text-neutral-900 md:hidden"
            >
              ✕
            </button>
          </div>
        </div>
        <input
          ref={uploadInputRef}
          type="file"
          accept=".md,.markdown,text/markdown,text/plain"
          multiple
          onChange={(e) => void handleUploadFiles(e.target.files)}
          className="hidden"
        />
        {uploadStatus && (
          <p className="mb-2 text-[11px] text-neutral-500">{uploadStatus}</p>
        )}
        {syncStatus && (
          <p
            className={`mb-2 text-[11px] ${
              syncStatus.startsWith("error")
                ? "text-red-600"
                : "text-neutral-500"
            }`}
          >
            {syncStatus}
          </p>
        )}
        {reindexStatus && (
          <p
            className={`mb-2 text-[11px] ${
              reindexStatus.startsWith("error")
                ? "text-red-600"
                : "text-neutral-500"
            }`}
          >
            {reindexStatus}
          </p>
        )}

        {creating && (
          <form onSubmit={handleCreate} className="mb-3 space-y-1">
            <input
              autoFocus
              type="text"
              value={newPath}
              onChange={(e) => setNewPath(e.target.value)}
              placeholder="ruta/nombre.es.md"
              className="w-full rounded border border-neutral-300 px-2 py-2 text-xs outline-none focus:border-neutral-500 md:py-1"
            />
            <button
              type="submit"
              disabled={creatingLoading || !newPath.trim()}
              className="w-full rounded bg-neutral-900 px-2 py-2 text-xs text-white disabled:opacity-50 md:py-1"
            >
              {creatingLoading ? "creando…" : "crear"}
            </button>
            {createError && (
              <p className="text-[11px] text-red-600">error: {createError}</p>
            )}
            <p className="text-[11px] text-neutral-400">
              Convención: <code>{"<ruta>/<base>.<lang>.<ext>"}</code>. Ej:{" "}
              <code>catalino/escena.es.md</code>.
            </p>
          </form>
        )}

        {fileList.length === 0 ? (
          <p className="text-xs text-neutral-400">
            Corpus vacío. Crea un archivo con &quot;+ nuevo&quot;, sube{" "}
            <code>.md</code> con &quot;subir&quot;, o ingesta una carpeta:{" "}
            <code>npm run corpus:ingest -- --dir ./examples/demo-corpus --slug demo</code>.
          </p>
        ) : sidebarView === "indice" ? (
          <IndexView
            files={fileList}
            activeId={activeId}
            onSelectFile={selectFile}
          />
        ) : (
          <FileTreeView
            nodes={fileTree}
            depth={0}
            activeId={activeId}
            closedFolders={closedFolders}
            actionMenuFor={actionMenuFor}
            renamingFor={renamingFor}
            renameDraft={renameDraft}
            confirmingDeleteFor={confirmingDeleteFor}
            editingMetadataFor={editingMetadataFor}
            metadataDraft={metadataDraft}
            actionError={actionError}
            shareEnabled={editorToken !== null}
            shareCopiedFor={shareCopiedFor}
            onToggleFolder={toggleFolder}
            onSelectFile={selectFile}
            onOpenMenu={(id) =>
              setActionMenuFor((prev) => (prev === id ? null : id))
            }
            onStartRename={startRename}
            onRenameDraftChange={setRenameDraft}
            onCommitRename={commitRename}
            onCancelRename={cancelRename}
            onStartDelete={startDelete}
            onCommitDelete={commitDelete}
            onCancelDelete={cancelDelete}
            onStartEditMetadata={startEditMetadata}
            onMetadataDraftChange={(field, value) =>
              setMetadataDraft((prev) => ({ ...prev, [field]: value }))
            }
            onCommitMetadata={commitMetadata}
            onCancelMetadata={cancelMetadata}
            onToggleShare={handleToggleShare}
            onCopyShareLink={handleCopyShareLink}
          />
        )}
      </aside>

      {/* Editor central */}
      <section className="flex min-h-0 flex-1 flex-col md:flex-initial">
        {/* Header del editor: visible solo en desktop. En móvil esa info ya
            está en el top bar. */}
        <div className="hidden items-center justify-between border-b border-neutral-200 px-4 py-2 text-xs md:flex">
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => prevNarrative && selectFile(prevNarrative.id)}
              disabled={!prevNarrative}
              title={
                prevNarrative
                  ? `anterior: ${prevNarrative.title ?? prevNarrative.path}`
                  : "no hay anterior"
              }
              aria-label="escena anterior"
              className="text-neutral-500 hover:text-neutral-900 disabled:opacity-30"
            >
              ←
            </button>
            <span className="font-mono text-neutral-500">
              {filePath || "—"}
            </span>
            <button
              type="button"
              onClick={() => nextNarrative && selectFile(nextNarrative.id)}
              disabled={!nextNarrative}
              title={
                nextNarrative
                  ? `siguiente: ${nextNarrative.title ?? nextNarrative.path}`
                  : "no hay siguiente"
              }
              aria-label="escena siguiente"
              className="text-neutral-500 hover:text-neutral-900 disabled:opacity-30"
            >
              →
            </button>
          </div>
          <div className="flex items-center gap-3">
            <span className="text-[11px] text-neutral-400">
              {wordCount.toLocaleString("es-ES")} palabras
            </span>
            {saveStatus}
            <button
              type="button"
              onClick={() => setCommentsOpen(true)}
              disabled={!activeId}
              title="comentarios anclados"
              className="relative text-neutral-500 hover:text-neutral-900 disabled:opacity-40"
              aria-label="comentarios"
            >
              comentarios
              {activeComments.filter((c) => c.resolvedAt === null).length >
                0 && (
                <span className="ml-1 rounded bg-amber-100 px-1 text-[10px] text-amber-900">
                  {
                    activeComments.filter((c) => c.resolvedAt === null)
                      .length
                  }
                </span>
              )}
            </button>
            <OverflowMenu
              ariaLabel="más acciones del archivo"
              items={[
                {
                  label: "historial de versiones",
                  onClick: () => setHistoryOpen(true),
                  disabled: !activeId,
                },
                {
                  label: "descargar como .md",
                  onClick: handleDownloadActive,
                  disabled: !activeId,
                },
              ]}
            />
          </div>
        </div>
        <MarkdownEditor
          content={content}
          disabled={!activeId}
          onChange={setContent}
          onSelectionChange={handleSelectionChange}
          commentAnchors={commentAnchors}
          onCommentAnchorClick={handleCommentAnchorClick}
          scrollToAnchor={scrollToAnchor}
        />
      </section>

      {/* Backdrop de la sheet (solo móvil) */}
      {mobileSheetOpen && (
        <div
          onClick={() => setMobileSheetOpen(false)}
          className="fixed inset-0 z-40 bg-black/30 md:hidden"
          aria-hidden
        />
      )}

      {/* Proposals panel: bottom-sheet en móvil, columna 3 en desktop */}
      <aside
        className={`fixed inset-x-0 bottom-0 z-50 flex max-h-[85dvh] min-h-0 transform flex-col rounded-t-2xl bg-white shadow-2xl transition-transform duration-200 md:static md:z-auto md:max-h-none md:transform-none md:rounded-none md:shadow-none md:transition-none ${
          mobileSheetOpen ? "translate-y-0" : "translate-y-full"
        } md:translate-y-0`}
      >
        {/* Handle + cierre del bottom-sheet (solo móvil) */}
        <div className="flex flex-col items-center md:hidden">
          <div className="mt-2 h-1 w-10 rounded-full bg-neutral-300" />
          <div className="flex w-full items-center justify-between px-3 py-2">
            <span className="text-xs font-semibold uppercase tracking-wide text-neutral-500">
              Propuestas {badgeCount > 0 && `· ${badgeCount}`}
            </span>
            <button
              type="button"
              onClick={() => setMobileSheetOpen(false)}
              aria-label="cerrar propuestas"
              className="-mr-1 text-neutral-500 hover:text-neutral-900"
            >
              ✕
            </button>
          </div>
        </div>
        <form
          onSubmit={handleInvoke}
          className="space-y-2 border-b border-neutral-200 p-3"
        >
          <div className="flex gap-2">
            <select
              value={operation}
              onChange={(e) => setOperation(e.target.value as Operation)}
              className="flex-1 rounded border border-neutral-300 bg-white px-2 py-1"
              aria-label="operación"
            >
              {OPERATIONS.map((op) => (
                <option key={op} value={op}>
                  {op}
                </option>
              ))}
            </select>
            <select
              value={model}
              onChange={(e) => setModel(e.target.value as ModelId)}
              className="flex-1 rounded border border-neutral-300 bg-white px-2 py-1"
              aria-label="modelo"
            >
              {MODELS.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.label}
                </option>
              ))}
            </select>
          </div>
          <textarea
            value={userPrompt}
            onChange={(e) => setUserPrompt(e.target.value)}
            placeholder={
              operation === "free_prompt"
                ? "Instrucción (obligatoria)"
                : "Matiz adicional (opcional)"
            }
            rows={3}
            className="w-full resize-none rounded border border-neutral-300 bg-white px-2 py-1 outline-none"
          />
          <button
            type="submit"
            disabled={loading || !activeId}
            onMouseDown={(e) => e.preventDefault()}
            className="w-full rounded bg-neutral-900 px-3 py-1.5 text-white disabled:opacity-50"
          >
            {loading ? "invocando…" : `invocar (${MODEL_LABELS[model]})`}
          </button>
          {error && <p className="text-xs text-red-600">error: {error}</p>}
          {sel.start !== sel.end ? (
            <div className="rounded border border-neutral-200 bg-neutral-50 p-2">
              <div className="mb-1 flex items-center justify-between">
                <span className="text-[11px] uppercase tracking-wide text-neutral-500">
                  Selección · {sel.end - sel.start} caracteres
                </span>
                <button
                  type="button"
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={clearSelection}
                  className="text-[11px] text-neutral-500 underline-offset-2 hover:text-neutral-900 hover:underline"
                >
                  limpiar
                </button>
              </div>
              <p className="max-h-32 overflow-y-auto whitespace-pre-wrap font-serif text-xs italic leading-relaxed text-neutral-700">
                {content.slice(sel.start, sel.end)}
              </p>
            </div>
          ) : (
            <p className="text-[11px] text-neutral-400">
              Cursor en posición {sel.start}. Selecciona texto en el editor
              para `expand`/`contract`/`rewrite`. Para `continue`, deja el
              cursor donde quieras insertar.
            </p>
          )}
        </form>

        <div className="flex-1 overflow-y-auto p-3">
          {savedCandidates.length > 0 && (
            <section className="mb-4">
              <h3 className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-neutral-500">
                Candidatos guardados · {savedCandidates.length}
              </h3>
              {savedCandidates.map((c) => (
                <article
                  key={c.candidateId}
                  className={`mb-3 rounded border p-3 text-xs ${
                    c.review
                      ? "border-emerald-400 bg-white"
                      : "border-amber-300 bg-amber-50/50"
                  }`}
                >
                  <header className="mb-1 flex items-center justify-between text-neutral-500">
                    <span className="font-mono">
                      {c.operation} · {c.provider}/{c.model}
                    </span>
                    {c.review && (
                      <span className="rounded bg-emerald-100 px-1.5 py-0.5 text-[11px] text-emerald-900">
                        revisando
                      </span>
                    )}
                  </header>
                  {c.userPrompt && (
                    <p className="mb-1 italic text-neutral-500">
                      {c.userPrompt}
                    </p>
                  )}
                  {c.review ? (
                    <DiffView
                      original={
                        c.review.range ? c.review.originalText : null
                      }
                      proposed={c.responseText}
                    />
                  ) : (
                    <p className="whitespace-pre-wrap font-serif text-sm leading-relaxed text-black">
                      {c.responseText}
                    </p>
                  )}
                  <footer className="mt-2 flex flex-wrap gap-2">
                    {c.review ? (
                      <>
                        <button
                          type="button"
                          onMouseDown={(e) => e.preventDefault()}
                          onClick={() =>
                            handleConfirmApplyCandidate(c.candidateId)
                          }
                          className="rounded bg-emerald-600 px-2 py-1 text-white"
                        >
                          confirmar y aplicar
                        </button>
                        <button
                          type="button"
                          onMouseDown={(e) => e.preventDefault()}
                          onClick={() =>
                            handleCancelCandidateReview(c.candidateId)
                          }
                          className="rounded bg-neutral-300 px-2 py-1"
                        >
                          cancelar
                        </button>
                      </>
                    ) : (
                      <>
                        <button
                          type="button"
                          onMouseDown={(e) => e.preventDefault()}
                          onClick={() => handleApplyCandidate(c.candidateId)}
                          className="rounded bg-emerald-600 px-2 py-1 text-white"
                        >
                          aplicar a selección
                        </button>
                        <button
                          type="button"
                          onMouseDown={(e) => e.preventDefault()}
                          onClick={() => handleDeleteCandidate(c.candidateId)}
                          className="rounded bg-neutral-300 px-2 py-1"
                        >
                          eliminar
                        </button>
                      </>
                    )}
                  </footer>
                  {c.errorDetail && (
                    <p className="mt-2 text-red-600">error: {c.errorDetail}</p>
                  )}
                </article>
              ))}
            </section>
          )}

          <h3 className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-neutral-500">
            Propuestas de la sesión · {proposals.length}
          </h3>
          {proposals.length === 0 ? (
            <p className="text-xs text-neutral-400">
              Sin propuestas en esta sesión.
            </p>
          ) : (
            proposals.map((p) => {
              const inactive =
                p.status === "accepted" ||
                p.status === "discarded" ||
                p.status === "saved";
              return (
                <article
                  key={p.invocationId}
                  className={`mb-3 rounded border p-3 text-xs ${
                    p.status === "reviewing"
                      ? "border-emerald-400 bg-white"
                      : "border-neutral-200"
                  } ${inactive ? "opacity-50" : ""}`}
                >
                  <header className="mb-1 flex items-center justify-between text-neutral-500">
                    <span className="font-mono">
                      {p.operation} · {p.provider}/{p.model}
                    </span>
                    {p.status === "reviewing" && (
                      <span className="rounded bg-emerald-100 px-1.5 py-0.5 text-[11px] text-emerald-900">
                        revisando
                      </span>
                    )}
                    {inactive && (
                      <span className="rounded bg-neutral-100 px-1.5 py-0.5">
                        {p.status}
                      </span>
                    )}
                  </header>
                  {p.userPrompt && (
                    <p className="mb-1 italic text-neutral-500">
                      {p.userPrompt}
                    </p>
                  )}
                  {p.status === "reviewing" ? (
                    <DiffView
                      original={p.originalText}
                      proposed={p.responseText}
                    />
                  ) : (
                    <p className="whitespace-pre-wrap font-serif text-sm leading-relaxed text-black">
                      {p.responseText}
                    </p>
                  )}
                  {p.status === "proposed" && (
                    <footer className="mt-2 flex flex-wrap gap-2">
                      <button
                        type="button"
                        onMouseDown={(e) => e.preventDefault()}
                        onClick={() => handleAccept(p.invocationId)}
                        className="rounded bg-emerald-600 px-2 py-1 text-white"
                      >
                        aceptar
                      </button>
                      <button
                        type="button"
                        onMouseDown={(e) => e.preventDefault()}
                        onClick={() => handleDiscard(p.invocationId)}
                        className="rounded bg-neutral-300 px-2 py-1"
                      >
                        descartar
                      </button>
                      <button
                        type="button"
                        onMouseDown={(e) => e.preventDefault()}
                        onClick={() => handleSave(p.invocationId)}
                        className="rounded bg-amber-500 px-2 py-1 text-white"
                      >
                        guardar
                      </button>
                    </footer>
                  )}
                  {p.status === "reviewing" && (
                    <footer className="mt-2 flex flex-wrap gap-2">
                      <button
                        type="button"
                        onMouseDown={(e) => e.preventDefault()}
                        onClick={() => handleConfirmAccept(p.invocationId)}
                        className="rounded bg-emerald-600 px-2 py-1 text-white"
                      >
                        confirmar y aplicar
                      </button>
                      <button
                        type="button"
                        onMouseDown={(e) => e.preventDefault()}
                        onClick={() => handleCancelReview(p.invocationId)}
                        className="rounded bg-neutral-300 px-2 py-1"
                      >
                        cancelar
                      </button>
                    </footer>
                  )}
                  {p.errorDetail && (
                    <p className="mt-2 text-red-600">error: {p.errorDetail}</p>
                  )}
                </article>
              );
            })
          )}
        </div>
      </aside>

      {activeId && (
        <HistoryPanel
          fileId={activeId}
          open={historyOpen}
          onClose={() => setHistoryOpen(false)}
          onRestored={handleVersionRestored}
        />
      )}
      {activeId && (
        <CommentsPanel
          fileId={activeId}
          open={commentsOpen}
          onClose={() => setCommentsOpen(false)}
          selectionText={selectionText}
          selectionPrefix={selectionPrefix}
          selectionSuffix={selectionSuffix}
          onCommentsChanged={setActiveComments}
          onJumpToComment={handleJumpToComment}
        />
      )}
    </main>
  );
}
