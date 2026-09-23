/**
 * Corpus file naming and metadata conventions.
 *
 * Conato is agnostic about what a corpus contains, but it does expect a shape:
 * `<base>.<lang>.md` filenames, folders mirroring the work's own hierarchy, and
 * YAML frontmatter carrying narrative metadata. These helpers are the single
 * place that knowledge lives, so ingestion and the API agree on it.
 *
 * Files that do not follow the conventions still work — they simply carry less
 * metadata into the prompt.
 */

/** Values accepted by the `files_corpus_layer_check` constraint. */
export const CORPUS_LAYERS = ["canon", "production", "meta"] as const;
export type CorpusLayer = (typeof CORPUS_LAYERS)[number];

/** Values accepted by the `files_kind_check` constraint. */
export const FILE_KINDS = [
  "character",
  "place",
  "scene",
  "fragment",
  "poem",
  "track",
  "video",
  "document",
  "note",
  "object",
] as const;
export type FileKind = (typeof FILE_KINDS)[number];

/** Values accepted by the `files_register_check` constraint. */
export const FILE_REGISTERS = [
  "narrative",
  "biography",
  "screenplay",
  "architecture",
  "transmedia",
  "notes",
] as const;
export type FileRegister = (typeof FILE_REGISTERS)[number];

export interface ParsedFileName {
  baseName: string;
  language: string;
}

/**
 * Splits `<base>.<lang>.md` into its parts.
 *
 * Only a two-letter segment is treated as a language code, so
 * `notes.draft.md` keeps `notes.draft` as its base name rather than reading
 * `draft` as a language. Files without a language segment fall back to
 * `fallbackLang`.
 */
export function parseFileName(
  fileName: string,
  fallbackLang: string,
): ParsedFileName {
  const stem = fileName.replace(/\.md$/, "");
  const match = /^(.+)\.([a-z]{2})$/.exec(stem);
  if (match?.[1] && match[2]) {
    return { baseName: match[1], language: match[2] };
  }
  return { baseName: stem, language: fallbackLang };
}

/**
 * Narrows an arbitrary frontmatter value to one of an allowed set, so that
 * values from user-authored YAML can never violate a database constraint.
 */
export function pickEnum<T extends string>(
  value: unknown,
  allowed: readonly T[],
): T | undefined {
  return typeof value === "string" && (allowed as readonly string[]).includes(value)
    ? (value as T)
    : undefined;
}

/**
 * Reads the language declared in frontmatter, accepting either `lang` or
 * `language`, and falling back to what the filename implied.
 */
export function resolveLanguage(
  frontmatter: Record<string, unknown>,
  fromFileName: string,
): string {
  const declared = frontmatter.lang ?? frontmatter.language;
  return typeof declared === "string" && declared.length > 0
    ? declared
    : fromFileName;
}

/**
 * Normalises a filesystem-relative path into the forward-slash form stored in
 * the database, so a corpus ingested on Windows matches one ingested on Unix.
 */
export function normalizeCorpusPath(relPath: string, separator = "/"): string {
  return relPath.split(separator).join("/").replace(/^\/+/, "");
}
