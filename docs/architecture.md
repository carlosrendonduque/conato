# Architecture

How Conato is put together and why. This documents the reasoning behind the
constraints, so that changes either respect them or overturn them deliberately.

## Principles

1. **Boring stack over experimental stack.** This is a tool for writing, not a
   place to try out technologies.
2. **Strict TypeScript.** No `any`, no `@ts-ignore`. The project is meant to
   last; loose types are paid for later with interest.
3. **Server-side by default.** Anything that can run on the server does. The
   client stays thin. Provider API keys live server-side and never reach the
   browser.
4. **No browser storage.** No `localStorage`, `sessionStorage` or IndexedDB.
   Persistence goes to the database, so a session survives a change of device.
5. **No premature abstraction.** One concrete implementation beats three layers
   of interface written for a hypothetical second case.
6. **Convention over configuration.** Fewer options, more sensible defaults.
7. **The provider seam stays a seam.** v0.1 ships Anthropic only, because it
   is the only provider verified end to end. The indirection around it is kept
   deliberately: adding a provider means an id, a factory entry and a default
   model — configuration, not architecture.

## The shape of the application

```
Browser (thin)                    Server (Next.js App Router)
┌────────────────────┐            ┌──────────────────────────────────┐
│ Tiptap editor      │──save─────▶│ /api/files/:id/save              │
│ Proposals panel    │──invoke───▶│ /api/invoke                      │
│ History, comments  │            │   ├─ compose context             │
└────────────────────┘            │   ├─ call Claude (AI SDK)        │
                                  │   └─ store as proposal           │
                                  ├──────────────────────────────────┤
                                  │ PostgreSQL + pgvector (Drizzle)  │
                                  │ files · versions · chunks ·      │
                                  │ invocations · candidates ·       │
                                  │ comments                         │
                                  └──────────────────────────────────┘
```

The corpus lives on the server and is the source of truth. Synchronising it
with anywhere else — a local vault, a cloud project — is the operator's
responsibility, not the application's. A ZIP export of the whole corpus is the
escape hatch; nothing in Conato locks the text in.

## How context is composed

This is the core of the tool. Every invocation assembles:

```
[preamble: operating instructions — stay in voice, return only the result]
[firm canon: full content of every file listed in the manifest]
[retrieved material: chunks from production material semantically related
 to the current selection or cursor context]
[active file: the complete file being edited, in its current state]
[location: the concrete selection, or the cursor position]
[operation: expand / condense / rewrite / continue / free prompt]
[user prompt, when there is one]
```

### Three layers that coexist

1. **Firm canon — always complete.** The small, critical documents that define
   the work, named by the manifest below. This set fits in the context window
   comfortably, so it goes in whole.
2. **Production material — retrieved.** The prose being written grows without
   bound and cannot be injected entirely. Embeddings plus similarity search
   surface the fragments related to where the cursor is.
3. **The active file — complete.** Whatever is being edited goes in whole. When
   the cursor sits on an empty line, the model needs to know what the rest of
   the file says, not just what the corpus says.

### Why both whole-corpus and RAG, rather than one

- **Firm canon is small and critical.** Injecting it whole guarantees the model
  never misses something essential. Retrieving over canon risks the model
  simply not finding a crucial fact.
- **Production material grows.** Retrieval is the only viable way for the model
  to know the rest of the work in progress.
- **More context produces better proposals.** The token cost is accepted
  deliberately as part of the value.

The boundary between the two is data, not code. A manifest inside the corpus —
`meta/canon-manifest.md` — lists the paths that count as firm canon; every
Markdown bullet in it is read as a corpus path, in the order given. It is an
ordinary corpus file, so the author edits it from inside the editor and the very
next invocation reflects the change. What is exploratory today can become canon
tomorrow without a deploy.

If the manifest is missing or empty, the canon section is simply absent and the
invocation proceeds on retrieval and the active file alone. Injection is
optional at runtime even though it is conceptually central.

The `files.corpus_layer` column (`canon` / `production` / `meta`) and the
`is_canon_firme` flag are metadata that the manifest does not consult; layer
drives ingestion and filtering, not prompt composition.

## Data model

| Table | Holds |
|---|---|
| `users` | Corpus owner. One row in practice; the column exists so auth can arrive without a migration. |
| `corpora` | A body of work. The schema supports many; the app currently resolves the first. |
| `files` | Markdown unit: path, frontmatter, content, corpus layer, plus canon-node axes (`kind`, `register`, `visibility`, `is_canon_firme`). |
| `file_versions` | Auto-save history, with milestones flagged for manual tagging. |
| `chunks` | Embedded fragments for retrieval, with a pgvector column. |
| `invocations` | Every model call: operation, provider, prompt, selection range, response, status. |
| `candidates` | Proposals explicitly kept, persisted per file. |
| `comments` | Author's private annotations anchored to text. |

Several shapes exist for futures that v1 does not use — multiple corpora, an
owner column, a private/AI toggle on comments. They are there so those
capabilities do not require a migration, not because they are implemented.

## Operations

There are five entry points — expand, condense, rewrite, continue-from-cursor,
and free prompt — but they are not five endpoints. They are one pattern:
**an operation, with context, over a selection or a position.** Adding a sixth
is a matter of adding an operation, not a route.

There is deliberately no "improve" operation. Improvement implies the model
deciding what is better. A specific improvement can always be requested through
a free prompt.

## Proposals, never direct writes

The model never writes to a file. Responses accumulate in a side panel, each
tagged with the model, the operation and the prompt that produced it. Each can
be accepted (which first shows a visual diff for confirmation), discarded, or
kept as a candidate that persists across sessions. Unsaved proposals disappear
when the file session ends — only what is explicitly kept survives.

This is a product decision, not a technical one: the author's judgement is the
point, so the tool is built around exercising it.

## Model choice: sequential, not parallel

Model selection happens per invocation, with a changeable default. Invoke one,
read the result, and reach for another only if the first did not satisfy. The
panel accumulates answers so they can be compared side by side.

Fanning a single prompt out to several models at once is not supported. Four
simultaneous answers is a comparison chore, not a workflow.

The model the client asks for is the model that runs, and the model recorded on
the invocation comes from the result rather than the request — otherwise the
comparison the panel exists for would be built on a fiction.

## Corpus conventions

The application is agnostic about content but expects some shape:

- **`<base>.<lang>.md`** filenames, `lang` being a two-letter code.
- **Folders** mirroring the work's own hierarchy, one per voice or section. The
  first path segment is used as a hint about the file's voice.
- **YAML frontmatter** with at minimum a title, and optionally `kind`, `voice`,
  `act` and `order`.

Files that do not follow the conventions still work; they simply carry less
metadata into the prompt.

## Known constraints

- **One corpus per database.** The schema supports many; the application picks
  the first. Multi-corpus needs a selector and scoping throughout.
- **Single user, shared secret.** See [SECURITY.md](../SECURITY.md).
- **Retrieval requires an embeddings provider.** Without one, files can be
  stored but not indexed, and the retrieval layer is unavailable.
- **Anthropic only.** The seam for other providers is intact but unused.
