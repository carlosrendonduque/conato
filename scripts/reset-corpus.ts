/**
 * Reset a corpus back to what is on disk.
 *
 * Deletes every file of the named corpus — and, by cascade, its versions,
 * invocations, proposals, candidates, comments and chunks — then re-ingests
 * the directory. Useful for demos and screen recordings: run it between takes
 * and the corpus is exactly as it was before you touched it.
 *
 * Safety: the slug is required and never defaulted, the corpus must already
 * exist, and nothing outside it is read or written. Pass `--yes` to skip the
 * confirmation prompt (for scripts); without it, the command prints what it is
 * about to destroy and waits.
 *
 * Usage:
 *   npm run corpus:reset -- --dir ./examples/demo-corpus --slug demo
 */
import { createInterface } from "node:readline/promises";
import { spawnSync } from "node:child_process";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { corpora, files } from "@/lib/db/schema";

function fail(message: string): never {
  console.error(`error: ${message}`);
  process.exit(1);
}

function flag(argv: string[], name: string): string | undefined {
  const i = argv.indexOf(`--${name}`);
  if (i === -1) return undefined;
  const value = argv[i + 1];
  if (value === undefined || value.startsWith("--")) {
    fail(`--${name} expects a value`);
  }
  return value;
}

async function confirm(question: string): Promise<boolean> {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  const answer = await rl.question(question);
  rl.close();
  return answer.trim().toLowerCase() === "y";
}

async function main() {
  const argv = process.argv.slice(2);
  if (argv.includes("--help") || argv.includes("-h")) {
    console.log(
      [
        "Usage: npm run corpus:reset -- --dir <path> --slug <slug> [--yes]",
        "",
        "  --dir <path>   directory to re-ingest after wiping (required)",
        "  --slug <slug>  corpus to reset; must already exist (required)",
        "  --yes          skip the confirmation prompt",
        "",
        "Deletes every file in the corpus, with everything that cascades from",
        "it, then re-ingests the directory.",
      ].join("\n"),
    );
    process.exit(0);
  }

  const dir = flag(argv, "dir");
  if (!dir) fail("--dir is required");
  const slug = flag(argv, "slug");
  if (!slug) fail("--slug is required");

  const [corpus] = await db
    .select()
    .from(corpora)
    .where(eq(corpora.slug, slug));
  if (!corpus) {
    fail(`corpus "${slug}" does not exist — run corpus:ingest first`);
  }

  const existing = await db
    .select({ id: files.id })
    .from(files)
    .where(eq(files.corpusId, corpus.id));

  console.log(
    `About to delete ${existing.length} file(s) from corpus "${slug}" ` +
      `and everything attached to them (versions, invocations, proposals, ` +
      `candidates, comments, chunks), then re-ingest ${dir}.`,
  );

  if (!argv.includes("--yes")) {
    const ok = await confirm("Type y to continue: ");
    if (!ok) {
      console.log("aborted — nothing was deleted");
      process.exit(0);
    }
  }

  await db.delete(files).where(eq(files.corpusId, corpus.id));
  console.log(`· deleted ${existing.length} file(s)`);

  // Re-ingest in a child process so both commands keep one implementation
  // of the ingestion rules.
  const result = spawnSync(
    process.execPath,
    [
      ...process.execArgv,
      new URL("./ingest-corpus.ts", import.meta.url).pathname,
      "--dir",
      dir,
      "--slug",
      slug,
      "--name",
      corpus.name,
    ],
    { stdio: "inherit" },
  );
  process.exit(result.status ?? 0);
}

main().catch((err: unknown) => {
  console.error("reset failed:", err);
  process.exit(1);
});
