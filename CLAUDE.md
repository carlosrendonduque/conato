# CLAUDE.md

Guidance for AI coding agents working in this repository. Humans should read
[README.md](README.md), [CONTRIBUTING.md](CONTRIBUTING.md) and
[docs/architecture.md](docs/architecture.md) — this file assumes those and adds
what an agent needs in order not to break the design.

## What Conato is

A WYSIWYG Markdown editor with Claude-powered writing assistance, for
long-form work. Self-hosted, single-user, and **agnostic about the body of work it
edits**. The corpus lives in the database; the application knows nothing about
any particular novel, script or archive.

## Non-negotiable properties

Any technical decision must respect these:

1. **Corpus-agnostic.** Nothing in `src/` may reference a specific body of
   work. Work-specific values belong in configuration, flags, or the database.
2. **Every model output is a proposal, never a direct write.** The model does
   not modify files. Responses land in the proposals panel; the author decides.
3. **Context is always rich.** Every invocation carries the full firm canon,
   retrieved production material, the complete active file, and the selection
   or cursor position.
4. **API keys are server-side.** They must never appear in a client bundle, a
   response body, or a log line.
5. **No browser storage.** No `localStorage`, `sessionStorage` or IndexedDB.
   Persistence goes to the database.
6. **Strict TypeScript.** No `any`, no `@ts-ignore`.
7. **Sequential model choice.** One invocation at a time, to one chosen model.
   Do not add "send to all models" behaviour. The model the client requests
   must be the model that runs, and the model recorded on the invocation must
   come from the result, not the request.
8. **The command layer is one general pattern** — operation, with context, over
   a selection or a position — not five hardcoded endpoints.

## Scope discipline

v0.1 is a verified baseline: several half-finished subsystems were **removed**
before release rather than shipped on trust. Do not reintroduce one without
running it. If you cannot demonstrate a feature working, it does not go in.

Conato says no on purpose. The excluded list in [ROADMAP.md](ROADMAP.md) — no
"improve" operation, no parallel model fan-out, no inline completions, no real
multi-user auth, no PDF/EPUB export — is design, not backlog.

**If a feature on that list looks easy to add while you are in there, the
default answer is no.** Propose it; do not implement it unprompted.

## Before making structural changes

Ask first, in conversation, before:

- Changing the data model, the system prompts, the command architecture, or the
  mechanics of the proposals panel.
- Adding a significant dependency — justify it. If a library solves the problem
  well, use it; if it brings 80% you do not need, write the 20% you do.
- Touching more than five files in a single change — explain the plan first.

## Verification

Every change must leave these green:

```bash
npm run typecheck && npm run lint && npm test
```

Develop against the bundled public-domain demo corpus:

```bash
npm run corpus:ingest -- --dir ./examples/demo-corpus --slug demo --name "Demo Corpus"
```

Never commit `.env.local` or any real API key, and never add fixture content
from a real body of work to this repository.

## Language

Code, comments in new files, commit messages and documentation are **English**.
UI strings are currently Spanish and older files carry Spanish comments; do not
mass-translate them as a side effect of an unrelated change.

Commits follow [Conventional Commits](https://www.conventionalcommits.org/).
