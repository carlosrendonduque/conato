# Roadmap

What is planned, what is deferred, and what is deliberately excluded. Items
here are intentions, not commitments — this is a side project.

If you want to work on something listed here, open an issue first so we do not
duplicate effort.

## What v0.1 is

v0.1 is a deliberately narrow baseline: **everything in it has been exercised
end to end against live APIs.** Several half-finished subsystems were removed
before release rather than shipped on trust — multi-provider support, corpus
sync to GitHub, a canon relation graph, and a machine-readable canon API. They
are listed below under [Removed before v0.1](#removed-before-v01) with the
reasoning, because "it was almost working" is the most expensive kind of
feature to inherit.

## Next up

**More providers.** The seam is intact — `PROVIDER_IDS`, a factory table and a
default model per provider — but only Anthropic ships, because only Anthropic
was verified. Adding OpenAI, Google or a local model means an id, a factory
entry, a default, and an env var. What it really needs is someone who will run
the five operations against it and confirm the results.

**Test coverage.** The suite covers the security-sensitive and convention-
parsing logic. The editor, the API routes and the retrieval pipeline are
untested; the verification that backs v0.1 was manual. Turning that manual pass
into an automated one is the single most useful contribution available.

**English UI and i18n.** All interface strings are currently Spanish. The
groundwork — extracting strings and adding a locale layer — is well scoped.

## High value, not started

- **Narrative index view.** The sidebar can already group by act and order; a
  proper reading view with previous/next navigation would let you move through
  a work as a work rather than as a filesystem.
- **Retrieval quality.** Metadata filters (prefer chunks from the same voice or
  section as the active file), MMR for source diversity instead of a redundant
  top-k, and tuning `topK` and `minSimilarity` against real usage.
- **Comparing versions.** The history stores every version; the UI can read and
  restore them, but not diff two distant ones against each other.

## Quality of life

- **Sliding session expiry.** The session cookie expires 30 days after issue.
  Re-issuing it when fewer than 7 days remain would make an active session feel
  indefinite.
- **Frontmatter editing UI.** Narrative hierarchy (`act`, `kind`, `voice`)
  lives in frontmatter, which is awkward to edit through Tiptap because it
  escapes the `---` fence when pasted as text.
- **Corpus layer selector on upload.** Uploaded files always land as
  `production`; choosing `meta` or `canon` should be possible from the UI.
- **Usage metrics.** Counts by operation and model, plus acceptance rate, to
  see which models actually earn their keep.
- **Mobile toolbar above the keyboard.** The editor toolbar can fall outside
  the viewport when the on-screen keyboard opens; a floating strip positioned
  with `visualViewport` would fix it.

## Known limitations

- **Accepting a proposal uses the current file content.** If the text is edited
  between invoking a model and accepting its proposal, the stored selection
  range can be stale and the replacement can land in the wrong place. Flushing
  auto-save before accepting mitigates but does not solve this.
- **Cursor position has no dedicated column.** For `continue` operations it is
  encoded as a zero-length `selection_range`. Distinguishing "cursor" from
  "empty selection" formally would need a column or a flag.
- **ProseMirror ↔ Markdown offset conversion** serializes `doc.cut(0, pos)` and
  measures the result. This handles the general case but may drift on deeply
  nested blocks or unusual marks.
- **One corpus per database.** The schema supports many; the application
  resolves the first corpus it finds. Multi-corpus needs a selector and scoping
  throughout.
- **Next.js 15.** One outstanding `postcss` advisory is only resolved by
  upgrading to Next 16, which is a migration rather than a patch.

## Removed before v0.1

Cut during the pre-release audit. Each is recoverable from git history if
someone wants to finish it properly.

- **OpenAI, Google and DeepSeek providers.** Wired but never run against a real
  key. Shipping four providers when one is verified misrepresents the tool.
- **Corpus sync to GitHub.** 324 lines that pushed a commit on every save,
  rename, delete, accept and restore — with a blocking `await` on a network
  call in the write path. Never exercised. The ZIP export covers backup without
  putting latency between the author and their own text.
- **Canon relation graph.** A `relations` table, a traversal helper and a
  prompt section for a node's neighbourhood. Nothing ever populated the table,
  so the section never rendered. Worth rebuilding when there is an ingest to
  fill it.
- **Machine-readable canon API** (`/api/canon/retrieve`, `/api/canon/related`).
  Semantic retrieval over the corpus for external consumers. It worked, but it
  existed to serve a separate application, sat outside the session gate, and
  was the one place in the codebase that had shipped a fail-open default. The
  editor's own retrieval is untouched.
- **hypothes.is embed** in the shared reader. A third-party script injected
  into every shared page, unverified, with privacy implications for anyone
  self-hosting. The token-gated read-only reader itself remains.

## Deliberately excluded

These are design decisions. They can be revisited with a good argument, but the
default answer is no.

- **An "improve" operation.** Improvement implies the model judging what is
  better. Ask for a specific change through a free-form prompt instead.
- **Broadcasting one prompt to several models at once.** Model selection is
  sequential by design: invoke one, read it, and only reach for another if the
  first did not satisfy.
- **Inline completions while typing.** Conato proposes only when asked.
- **Model-visible comments.** Comments are private notes to the author. The
  data model leaves room for a private/AI toggle later.
- **Real authentication and multi-user.** See [SECURITY.md](SECURITY.md).
- **PDF, EPUB or static HTML export**, MDX, inline media, and full-text search
  with highlighting.
