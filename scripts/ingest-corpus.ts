/**
 * Ingest a Markdown corpus into Conato.
 *
 * Walks a directory of `.md` files, upserts each one as a file in the target
 * corpus (preserving the directory structure as the file path), and indexes
 * it for semantic retrieval.
 *
 * The script is corpus-agnostic: everything that identifies a body of work
 * comes from flags, never from the code. It is idempotent (upsert by path)
 * and it only ever writes to the corpus named by `--slug`.
 *
 * Usage:
 *   npm run corpus:ingest -- --dir ./corpus --slug my-work --name "My Work"
 *
 * Flags:
 *   --dir <path>      Directory to read (required).
 *   --slug <slug>     Corpus slug; created if missing (required).
 *   --name <name>     Human-readable corpus name (defaults to the slug).
 *   --owner <handle>  Owner handle; created if missing (default: "author").
 *   --layer <layer>   canon | production | meta (default: "production").
 *   --lang <code>     Fallback language when the filename does not encode one
 *                     and the frontmatter does not declare one (default: "es").
 *   --canon-firme     Set the is_canon_firme metadata flag on every file.
 *                     NOTE: this flag is metadata only. What actually gets
 *                     injected whole into each prompt is whatever
 *                     meta/canon-manifest.md lists.
 *   --no-index        Skip embedding/indexing (useful without VOYAGE_API_KEY).
 */
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";
import matter from "gray-matter";
import { and, eq } from "drizzle-orm";
import {
  CORPUS_LAYERS,
  FILE_KINDS,
  FILE_REGISTERS,
  type CorpusLayer,
  normalizeCorpusPath,
  parseFileName,
  pickEnum,
  resolveLanguage,
} from "@/lib/corpus/conventions";
import { db } from "@/lib/db/client";
import { corpora, files, users } from "@/lib/db/schema";
import { indexFile } from "@/lib/rag/indexer";

interface Options {
  dir: string;
  slug: string;
  name: string;
  owner: string;
  layer: CorpusLayer;
  lang: string;
  canonFirme: boolean;
  index: boolean;
}

function fail(message: string): never {
  console.error(`error: ${message}`);
  console.error("run with --help for usage");
  process.exit(1);
}

function parseArgs(argv: string[]): Options {
  if (argv.includes("--help") || argv.includes("-h")) {
    console.log(
      [
        "Usage: npm run corpus:ingest -- --dir <path> --slug <slug> [options]",
        "",
        "  --dir <path>      directory of .md files to ingest (required)",
        "  --slug <slug>     target corpus slug, created if missing (required)",
        "  --name <name>     corpus display name (default: the slug)",
        "  --owner <handle>  owner handle, created if missing (default: author)",
        `  --layer <layer>   ${CORPUS_LAYERS.join(" | ")} (default: production)`,
        "  --lang <code>     fallback language code (default: es)",
        "  --canon-firme     set the is_canon_firme metadata flag (note: firm-canon",
        "                    injection is driven by meta/canon-manifest.md)",
        "  --no-index        skip embeddings (no VOYAGE_API_KEY needed)",
      ].join("\n"),
    );
    process.exit(0);
  }

  const flag = (name: string): string | undefined => {
    const i = argv.indexOf(`--${name}`);
    if (i === -1) return undefined;
    const value = argv[i + 1];
    if (value === undefined || value.startsWith("--")) {
      fail(`--${name} expects a value`);
    }
    return value;
  };

  const dir = flag("dir");
  if (!dir) fail("--dir is required");
  const slug = flag("slug");
  if (!slug) fail("--slug is required");
  if (!/^[a-z0-9][a-z0-9-]*$/.test(slug)) {
    fail("--slug must be lowercase alphanumeric with dashes");
  }

  const layer = flag("layer") ?? "production";
  if (!CORPUS_LAYERS.includes(layer as CorpusLayer)) {
    fail(`--layer must be one of: ${CORPUS_LAYERS.join(", ")}`);
  }

  try {
    if (!statSync(dir).isDirectory()) fail(`${dir} is not a directory`);
  } catch {
    fail(`cannot read directory ${dir}`);
  }

  return {
    dir,
    slug,
    name: flag("name") ?? slug,
    owner: flag("owner") ?? "author",
    layer: layer as CorpusLayer,
    lang: flag("lang") ?? "es",
    canonFirme: argv.includes("--canon-firme"),
    index: !argv.includes("--no-index"),
  };
}

/** Recursively collect `.md` files, returning paths relative to `root`. */
function collectMarkdown(root: string, current = root): string[] {
  const found: string[] = [];
  for (const entry of readdirSync(current, { withFileTypes: true })) {
    if (entry.name.startsWith(".")) continue;
    const full = join(current, entry.name);
    if (entry.isDirectory()) {
      found.push(...collectMarkdown(root, full));
    } else if (entry.name.endsWith(".md")) {
      found.push(relative(root, full));
    }
  }
  return found.sort();
}

async function ensureUser(handle: string) {
  const [existing] = await db
    .select()
    .from(users)
    .where(eq(users.handle, handle));
  if (existing) return existing;
  const [created] = await db.insert(users).values({ handle }).returning();
  if (!created) throw new Error(`could not create user ${handle}`);
  console.log(`· created user: ${handle}`);
  return created;
}

async function ensureCorpus(ownerId: string, slug: string, name: string) {
  const [existing] = await db
    .select()
    .from(corpora)
    .where(eq(corpora.slug, slug));
  if (existing) return existing;
  const [created] = await db
    .insert(corpora)
    .values({ ownerId, slug, name })
    .returning();
  if (!created) throw new Error(`could not create corpus ${slug}`);
  console.log(`· created corpus: ${slug}`);
  return created;
}

async function upsertFile(
  corpusId: string,
  relPath: string,
  raw: string,
  opts: Options,
): Promise<string> {
  const path = normalizeCorpusPath(relPath, sep);
  const fileName = path.slice(path.lastIndexOf("/") + 1);
  const { baseName, language } = parseFileName(fileName, opts.lang);

  const parsed = matter(raw);
  const frontmatter = parsed.data as Record<string, unknown>;

  const resolvedLanguage = resolveLanguage(frontmatter, language);

  const [existing] = await db
    .select({ id: files.id })
    .from(files)
    .where(and(eq(files.corpusId, corpusId), eq(files.path, path)));

  if (existing) {
    await db
      .update(files)
      .set({ content: raw, frontmatter, language: resolvedLanguage })
      .where(eq(files.id, existing.id));
    return existing.id;
  }

  const [created] = await db
    .insert(files)
    .values({
      corpusId,
      path,
      baseName,
      language: resolvedLanguage,
      extension: "md",
      frontmatter,
      content: raw,
      corpusLayer: opts.layer,
      kind: pickEnum(frontmatter.kind, FILE_KINDS) ?? null,
      register: pickEnum(frontmatter.register, FILE_REGISTERS) ?? "narrative",
      isCanonFirme: opts.canonFirme,
    })
    .returning({ id: files.id });
  if (!created) throw new Error(`could not create file ${path}`);
  return created.id;
}

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  console.log(`Ingesting "${opts.slug}" from ${opts.dir} (layer: ${opts.layer})`);

  const user = await ensureUser(opts.owner);
  const corpus = await ensureCorpus(user.id, opts.slug, opts.name);

  const mdFiles = collectMarkdown(opts.dir);
  if (mdFiles.length === 0) {
    console.log("no .md files found — nothing to do");
    process.exit(0);
  }

  let totalChunks = 0;
  let indexed = 0;
  for (const relPath of mdFiles) {
    const raw = readFileSync(join(opts.dir, relPath), "utf8").trim();
    if (!raw) continue;
    const fileId = await upsertFile(corpus.id, relPath, raw, opts);

    if (!opts.index) {
      console.log(`  · ${relPath} (not indexed)`);
      continue;
    }
    try {
      const result = await indexFile(fileId);
      totalChunks += result.chunksWritten;
      indexed += 1;
      console.log(`  ✓ ${relPath} → ${result.chunksWritten} chunks`);
    } catch (err) {
      // A missing or rate-limited embeddings provider should not lose the
      // ingested content: the file is already stored and can be reindexed.
      console.warn(
        `  ! ${relPath} stored but not indexed: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  console.log(
    `\nDone: ${mdFiles.length} files · ${indexed} indexed · ${totalChunks} chunks in corpus "${opts.slug}".`,
  );
  process.exit(0);
}

main().catch((err: unknown) => {
  console.error("ingest failed:", err);
  process.exit(1);
});
