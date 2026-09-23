import { and, eq, inArray } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { type File, files } from "@/lib/db/schema";

/**
 * Paths donde se busca el manifiesto de canon firme, en orden de
 * preferencia. Editar ese archivo (vía la UI o el endpoint normal de
 * `/api/files/:id`) cambia lo que cuenta como canon firme sin redeploy.
 *
 * El segundo path es el nombre histórico y se mantiene por
 * compatibilidad con corpus creados antes de que existiera el neutral.
 */
export const MANIFEST_PATHS = [
  "meta/canon-manifest.md",
  "meta/manifiesto_canon_firme.es.md",
] as const;

/** El path canónico para corpus nuevos. */
export const MANIFEST_PATH = MANIFEST_PATHS[0];

/**
 * Extrae los paths del manifiesto. Convención: cualquier línea que empiece
 * con un bullet de Markdown (`- `, `* ` o `+ `, opcionalmente escapado con
 * backslash) se interpreta como un path al canon. El resto del archivo es
 * texto libre (encabezados, comentarios) que se ignora.
 *
 * El backslash opcional es necesario porque al pegar texto Markdown en
 * Tiptap, las líneas que empiezan con `-` quedan como párrafos literales,
 * y el serializador escapa el `-` como `\-` para que no se reinterprete.
 * Aceptar ambos es más robusto que pedirle al usuario formato exacto.
 */
export function parseManifest(content: string): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const rawLine of content.split("\n")) {
    const line = rawLine.trim();
    const match = /^\\?[-*+]\s+(.+)$/.exec(line);
    if (!match) continue;
    const path = match[1]?.trim() ?? "";
    if (path.length === 0) continue;
    if (seen.has(path)) continue;
    seen.add(path);
    out.push(path);
  }
  return out;
}

/**
 * Carga el manifiesto y devuelve los archivos del corpus que lista, en el
 * orden en que aparecen en el manifiesto. Si el manifiesto no existe, no
 * tiene paths, o ningún path encontrado existe, devuelve `[]` —  la
 * inyección de canon es opcional desde el punto de vista del runtime
 * (no rompe la invocación si falta), aunque conceptualmente es crítica.
 *
 * Sin caché por ahora: edits al manifiesto o a los archivos canon deben
 * reflejarse en la siguiente invocación, no en la siguiente sesión.
 */
export async function loadCanonFirme(corpusId: string): Promise<File[]> {
  const candidates = await db
    .select()
    .from(files)
    .where(
      and(
        eq(files.corpusId, corpusId),
        inArray(files.path, [...MANIFEST_PATHS]),
      ),
    );

  // Si existen ambos, gana el neutral: MANIFEST_PATHS está en orden de
  // preferencia y el legacy es solo compatibilidad hacia atrás.
  const manifest = MANIFEST_PATHS.map((p) =>
    candidates.find((f) => f.path === p),
  ).find((f) => f !== undefined);

  if (!manifest) return [];

  const paths = parseManifest(manifest.content);
  if (paths.length === 0) return [];

  const found = await db
    .select()
    .from(files)
    .where(and(eq(files.corpusId, corpusId), inArray(files.path, paths)));

  // Mantener el orden definido en el manifiesto, no el orden arbitrario
  // de la query. El autor decide la jerarquía.
  const orderMap = new Map(paths.map((p, i) => [p, i]));
  return [...found].sort(
    (a, b) =>
      (orderMap.get(a.path) ?? Number.MAX_SAFE_INTEGER) -
      (orderMap.get(b.path) ?? Number.MAX_SAFE_INTEGER),
  );
}
