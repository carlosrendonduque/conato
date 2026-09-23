/**
 * Separación del frontmatter YAML respecto del cuerpo Markdown.
 *
 * El editor WYSIWYG no puede recibir el frontmatter: Markdown lee
 * `---` + texto + `---` como una regla horizontal seguida de un
 * encabezado setext, así que Tiptap lo renderiza como título y, al
 * reserializar, lo devuelve convertido en `## title: "..." kind: scene
 * voice: ...`. Toda la metadata se pierde en el primer guardado.
 *
 * Por eso el cuerpo es lo único que se edita, y el bloque de
 * frontmatter viaja aparte y se vuelve a pegar tal cual al guardar.
 * Se conserva como texto literal, no como objeto reserializado, para
 * no reordenar claves ni normalizar comillas de algo que el autor
 * escribió a mano.
 */

export interface SplitDocument {
  /** El bloque de frontmatter completo, delimitadores incluidos, o "" si no hay. */
  frontmatter: string;
  /** El Markdown editable, sin frontmatter. */
  body: string;
}

/**
 * Un bloque de frontmatter válido abre con `---` en la primerísima línea
 * y cierra con otra línea `---`. Cualquier otra cosa —incluido un `---`
 * suelto que sea una regla horizontal— se trata como cuerpo.
 *
 * El match se traga también la línea en blanco que separa el bloque del
 * cuerpo: es un separador, no contenido. Así `split` y `join` son
 * inversas exactas y el contenido no gana saltos de línea a cada
 * guardado.
 */
const FRONTMATTER = /^---\r?\n[\s\S]*?\r?\n---[ \t]*(?:\r?\n){0,2}/;

export function splitFrontmatter(raw: string): SplitDocument {
  const match = FRONTMATTER.exec(raw);
  if (!match) return { frontmatter: "", body: raw };

  const block = match[0];
  return {
    frontmatter: block.replace(/[\s]*$/, ""),
    body: raw.slice(block.length),
  };
}

/**
 * Vuelve a unir cuerpo y frontmatter. Separa ambos con una línea en
 * blanco, que es la convención del corpus, y garantiza que el resultado
 * vuelve a ser parseable por `splitFrontmatter`.
 *
 * Si no hay frontmatter, devuelve el cuerpo intacto.
 */
export function joinFrontmatter(frontmatter: string, body: string): string {
  if (frontmatter === "") return body;
  return `${frontmatter}\n\n${body.replace(/^\r?\n+/, "")}`;
}

/**
 * Reescribe el bloque de frontmatter de un documento a partir de un
 * objeto de metadata, conservando el cuerpo intacto.
 *
 * Se usa cuando la metadata se edita fuera del editor (el endpoint
 * `PATCH /api/files/:id/frontmatter`), para que el YAML dentro de
 * `content` no quede desincronizado de la columna `frontmatter`. Lo que
 * se exporta a disco es `content`, así que esa divergencia sería
 * metadata perdida en cuanto alguien descargue el corpus.
 *
 * A diferencia de `joinFrontmatter`, aquí sí reserializamos: el autor
 * pidió explícitamente un cambio de metadata, así que normalizar el
 * formato es aceptable. Para una edición de prosa normal seguimos
 * conservando el bloque literal.
 */
export function replaceFrontmatter(
  raw: string,
  data: Record<string, unknown>,
): string {
  const { body } = splitFrontmatter(raw);
  const entries = Object.entries(data).filter(([, v]) => v !== undefined);
  if (entries.length === 0) return body;

  const lines = entries.map(([key, value]) => `${key}: ${formatYamlValue(value)}`);
  return joinFrontmatter(`---\n${lines.join("\n")}\n---`, body);
}

/**
 * Serializa un valor escalar a YAML. El frontmatter del corpus es
 * deliberadamente plano —título, voz, lengua, kind, acto, orden— así que
 * no necesitamos un serializador completo; cualquier cosa que no sea
 * escalar se emite como JSON, que es YAML válido.
 */
function formatYamlValue(value: unknown): string {
  if (typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }
  if (value === null) return "null";
  if (typeof value === "string") {
    // Entrecomillamos salvo que sea inequívocamente un escalar simple,
    // para que un título con `:` o que parezca número no rompa el YAML.
    return /^[A-Za-z_][\w .-]*$/.test(value) && !/^(true|false|null)$/i.test(value)
      ? value
      : JSON.stringify(value);
  }
  return JSON.stringify(value);
}
