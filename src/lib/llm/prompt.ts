import { readFile } from "node:fs/promises";
import path from "node:path";
import type { File } from "@/lib/db/schema";
import type { Operation, SelectionRange } from "./types";

interface BuildSystemPromptArgs {
  activeFile: File;
  operation: Operation;
  userPrompt: string | null;
  selection: { text: string; range: SelectionRange } | null;
  cursorPosition: number | null;
  /** Vacío en v1: el ingestor de canon firme aún no existe. */
  canonFiles?: File[];
  /** Fragmentos del corpus en producción recuperados por similitud
   *  semántica con la selección o el contexto del cursor. Si está vacío
   *  o ausente, la sección no aparece en el prompt. */
  relevantChunks?: Array<{
    text: string;
    filePath: string;
    similarity: number;
  }>;
}

const PREAMBLE_PATH = path.resolve(process.cwd(), "src/lib/llm/preamble.md");
let cachedPreamble: string | null = null;

async function loadPreamble(): Promise<string> {
  if (cachedPreamble !== null) return cachedPreamble;
  cachedPreamble = (await readFile(PREAMBLE_PATH, "utf8")).trim();
  return cachedPreamble;
}

/**
 * Deriva la "voz" del archivo del primer segmento de su path. La
 * jerarquía canónica de la obra organiza el corpus por voz/sección
 * (un folder por personaje, lugar o sección) y por buckets
 * meta/appendix/corrupted/music/game/misc/registry. El primer segmento
 * basta como pista para el modelo; cuando un archivo está en raíz, no
 * inferimos voz.
 */
function inferVoice(path: string): string | null {
  const segments = path.split("/").filter((s) => s.length > 0);
  if (segments.length <= 1) return null;
  return segments[0] ?? null;
}

/**
 * Convierte el frontmatter (jsonb arbitrario) en pares legibles para el
 * prompt. Mostramos solo strings/numbers/booleans top-level: arrays y
 * objetos anidados se omiten para no inundar el prompt con estructura.
 */
function describeFrontmatter(fm: unknown): string[] {
  if (!fm || typeof fm !== "object") return [];
  const out: string[] = [];
  for (const [key, value] of Object.entries(fm as Record<string, unknown>)) {
    if (
      typeof value === "string" ||
      typeof value === "number" ||
      typeof value === "boolean"
    ) {
      out.push(`${key}=${value}`);
    }
  }
  return out;
}

const OPERATION_INSTRUCTIONS: Record<Operation, string> = {
  expand:
    "Expande el texto seleccionado: hazlo más largo manteniendo voz, registro y sentido.",
  contract:
    "Contrae el texto seleccionado: hazlo más corto sin perder lo esencial.",
  rewrite:
    "Reescribe el texto seleccionado: ofrece una alternativa distinta sin juicio implícito de mejora.",
  continue:
    "Continúa el archivo desde la posición del cursor de forma coherente con lo que ya está escrito.",
  free_prompt:
    "Atiende la instrucción específica del usuario sobre el texto o el archivo activo.",
};

export async function buildSystemPrompt(
  args: BuildSystemPromptArgs,
): Promise<string> {
  const preamble = await loadPreamble();
  const parts: string[] = [preamble];

  if (args.canonFiles && args.canonFiles.length > 0) {
    parts.push("\n# Canon firme\n");
    for (const f of args.canonFiles) {
      parts.push(`## ${f.path}\n\n${f.content}`);
    }
  }

  if (args.relevantChunks && args.relevantChunks.length > 0) {
    parts.push("\n# Material relacionado del corpus");
    parts.push(
      "Fragmentos del material en producción recuperados por similitud semántica con la selección o el contexto del cursor. Úsalos como referencia tonal y de continuidad, no como contenido a citar literalmente.\n",
    );
    for (const c of args.relevantChunks) {
      parts.push(`## ${c.filePath}\n\n${c.text}`);
    }
  }

  parts.push("\n# Archivo activo");
  parts.push(`Ruta: ${args.activeFile.path}`);
  parts.push(`Lengua: ${args.activeFile.language}`);
  // El primer segmento del path es la voz / sección canónica
  // (un personaje, un lugar, una sección) o `meta` para documentación. Esto le
  // da al modelo el ancla de registro sin pedirle que infiera del path.
  const voice = inferVoice(args.activeFile.path);
  if (voice) parts.push(`Voz / sección: ${voice}`);
  // El frontmatter del archivo puede declarar metadata adicional —
  // notablemente `kind` (diario, log, registro, escena, apéndice, etc.).
  // Lo exponemos como contexto explícito para que el modelo no tenga
  // que adivinarlo del contenido.
  const fmPairs = describeFrontmatter(args.activeFile.frontmatter);
  if (fmPairs.length > 0) {
    parts.push(`Metadata del archivo: ${fmPairs.join(" · ")}`);
  }
  parts.push("\n## Contenido completo\n");
  parts.push(args.activeFile.content);

  parts.push("\n# Ubicación de la operación");
  if (args.selection) {
    parts.push(
      `Selección (caracteres ${args.selection.range.from}–${args.selection.range.to}):`,
    );
    parts.push("```");
    parts.push(args.selection.text);
    parts.push("```");
  } else if (args.cursorPosition !== null) {
    parts.push(`Cursor en posición ${args.cursorPosition}.`);
  } else {
    parts.push("Sin ubicación específica (operación sobre el archivo entero).");
  }

  parts.push("\n# Operación");
  parts.push(`Tipo: ${args.operation}`);
  parts.push(`Instrucción base: ${OPERATION_INSTRUCTIONS[args.operation]}`);

  if (args.userPrompt) {
    parts.push("\n# Instrucción específica del usuario\n");
    parts.push(args.userPrompt);
  }

  return parts.join("\n");
}
