# Conato

[![CI](https://github.com/carlosrendonduque/conato/actions/workflows/ci.yml/badge.svg)](https://github.com/carlosrendonduque/conato/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)

A WYSIWYG Markdown editor with Claude-powered writing assistance, built for
long-form work. Self-hosted, single-user, corpus-agnostic.

The name comes from the Latin *conatus*: the impulse, the effort, the gesture
just beginning.

> **Status: v0.1, single-user by design.** Conato was built as one author's
> writing tool and opened up because the shape of it turned out to be generally
> useful. It has no user accounts, no multi-tenancy and no billing — see
> [Security model](#security-model) before you put it on the open internet.
>
> Everything documented here has been exercised end to end against live APIs.
> Features that were not verified were removed rather than shipped on trust;
> [ROADMAP.md](ROADMAP.md) says what is missing and why.

## Why this exists

Writing with AI assistance usually means a browser tab next to your editor and
copy-pasting between the two. Context is lost at every hop, and the model
answers without knowing the rest of your work.

Conato collapses that into one interface. Your corpus lives on the server. Every
invocation automatically carries your canon, semantically relevant passages from
the rest of your material, and the full file you are editing. Answers arrive as
**proposals in a side panel** — never written straight into your text.

## See it work

Six short clips, each one feature, recorded against the bundled demo corpus.
The walkthrough that produced them is in [docs/demo.md](docs/demo.md).

**1 · The editor** — Markdown without the punctuation, and metadata that stays
out of the way.

https://github.com/user-attachments/assets/8437d1f8-63d0-4760-8129-549d655d798b

**2 · The five operations** — expand, condense, rewrite, continue and free
prompt, over a selection or at the cursor.

https://github.com/user-attachments/assets/ba35c939-20fc-4b3c-8303-fa4eaab3f324

**3 · Proposals** — accept behind a visual diff, discard, or keep as a
candidate that outlives the session.

https://github.com/user-attachments/assets/0cb40f5b-344d-4de1-9085-023ff37a58db

**4 · Choosing a model** — the same selection sent to Opus 5 and then Sonnet 5,
both answers side by side.

https://github.com/user-attachments/assets/aa1df97a-7d39-4c6f-a4de-ad6244925d40

**5 · Context** — why the proposals sound like the work: canon injected whole,
the rest of the corpus retrieved by similarity, the active file entire.

https://github.com/user-attachments/assets/513d6f37-4f77-4c5b-b1b8-0b4d123af8e7

**6 · Versions and comments** — every save kept, milestones tagged, restore,
and private notes anchored to the text.

https://github.com/user-attachments/assets/f318880e-faba-4096-b8ec-2290ecc264ef

## What it does

- **WYSIWYG Markdown editing** on Tiptap, syntax hidden where possible.
- **Five operations**: expand, condense, rewrite, continue-from-cursor, and
  free-form prompt — invoked on a selection or at the cursor.
- **Model chosen per invocation** — Opus 5, Sonnet 5 or Haiku 4.5. Send the
  same operation to a second model and the side panel accumulates both answers
  so you can compare them.
- **Every output is a proposal.** Accepting one shows a visual diff first.
  Proposals can be accepted, discarded, or kept as candidates that persist.
- **Rich context on every call**: full canon documents, RAG over your material
  in production, the active file, and the cursor or selection.
- **Versioning**: granular background auto-save, manual milestone tagging, and
  restore from history.
- **Personal comments** anchored to text — notes to yourself, not visible to
  the model.
- **Retrieval stays current**: saving a file re-embeds it in the background, so
  proposals are never built on stale text.
- **Backups**: download the whole corpus as a ZIP, or any single file as
  Markdown.

### What it deliberately does not do

No "improve" operation (improvement implies the model judging what is better).
No fanning one prompt out to several models at once. No inline Cursor-style
suggestions while you type. No real auth, no multi-user, no PDF/EPUB export.
Scope discipline is part of the design — see [docs/architecture.md](docs/architecture.md).

## Quick start

Requirements: **Node.js 22+**, **Docker** (or any PostgreSQL 16+ with the
`pgvector` extension), and an Anthropic API key.

```bash
git clone https://github.com/carlosrendonduque/conato.git
cd conato
npm install

cp .env.example .env.local     # then fill in the values — see below
docker compose up -d           # PostgreSQL 16 + pgvector on :5432
npm run db:migrate

# Load the bundled public-domain demo corpus so the app has something to show
npm run corpus:ingest -- --dir ./examples/demo-corpus --slug demo --name "Demo Corpus"

npm run dev                    # http://localhost:3000
```

Log in with the value you set for `CONATO_ACCESS_SECRET`, then follow
[docs/demo.md](docs/demo.md) for a tour of what the tool does.

### Running everything in Docker

The command above runs the app on your machine against a containerised
database, which is the usual development loop. To run the whole stack in
containers instead:

```bash
docker compose --profile app up -d --build    # app on :3000, database on :5432
```

Generate the two required secrets with:

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

### Environment variables

| Variable | Required | Purpose |
|---|---|---|
| `CONATO_ACCESS_SECRET` | **yes** | The shared secret that unlocks the app. 16+ chars. |
| `CONATO_COOKIE_SECRET` | **yes** | Signs the session cookie. Must differ from the above. |
| `DATABASE_URL` | **yes** | PostgreSQL with `pgvector`. |
| `ANTHROPIC_API_KEY` | for assistance | Without it the editor works but produces no proposals. |
| `VOYAGE_API_KEY` | for retrieval | Embeddings. Without it, ingestion stores files but cannot index them. |
| `CONATO_EDITOR_TOKEN` | no | Enables `/editor/<token>` read-only sharing. Unset means 404. |

API keys are read server-side only and are never sent to the browser.

## Bringing your own corpus

Conato edits plain `.md` files and does not care what they contain. The
conventions it understands:

- **`<base>.<lang>.md`** filenames, e.g. `chapter_01.es.md`.
- **Folders** mirroring your work's own hierarchy — one per voice, character,
  or section.
- **YAML frontmatter** carrying at minimum `title`, and optionally `kind`,
  `voice`, `act` and `order`, which drive the narrative index view.

Ingest any directory of Markdown:

```bash
npm run corpus:ingest -- --dir /path/to/corpus --slug my-work --name "My Work"
npm run corpus:ingest -- --help     # all flags
```

Files load as `production` by default; use `--layer meta` for documentation and
notes.

### Choosing what counts as firm canon

A file named **`meta/canon-manifest.md`** inside your corpus decides which
documents are injected **whole** into every prompt instead of being retrieved by
similarity. Any Markdown bullet in that file is read as a corpus path:

```markdown
- meta/canon.es.md
- character/protagonist.es.md
```

Keep the list short — those documents are paid for on every single call. The
manifest is ordinary corpus data, so you can edit it from inside Conato and the
next invocation picks it up; there is no redeploy and no configuration file.
(Corpora created before this convention may use the older path
`meta/manifiesto_canon_firme.es.md`, which is still honoured.)

See [examples/](examples/) for a working demonstration, manifest included.

## Security model

Conato's access control is **one shared secret**, not user accounts. That is
adequate for a personal instance at an unadvertised URL, and it is not a
substitute for authentication. Before deploying:

- Use a long random `CONATO_ACCESS_SECRET`. The app refuses to start on the
  example placeholders or on low-entropy values, but it cannot stop you from
  choosing something weak.
- Login attempts are rate-limited per client, best-effort and in-process. On a
  serverless host, each instance counts separately.
- Anyone holding the shared secret has full read and write access to the whole
  corpus.

To report a vulnerability, see [SECURITY.md](SECURITY.md).

## Deploying

[![Deploy with Vercel](https://vercel.com/button)](https://vercel.com/new/clone?repository-url=https%3A%2F%2Fgithub.com%2Fcarlosrendonduque%2Fconato&env=CONATO_ACCESS_SECRET,CONATO_COOKIE_SECRET,DATABASE_URL,ANTHROPIC_API_KEY,VOYAGE_API_KEY&envDescription=Access%20secrets%2C%20a%20Postgres%20URL%20with%20pgvector%2C%20and%20an%20Anthropic%20API%20key&envLink=https%3A%2F%2Fgithub.com%2Fcarlosrendonduque%2Fconato%23environment-variables&project-name=conato&repository-name=conato)

You will still need to run migrations once against the database before the app
works — see below.

Conato runs on any host that can serve a Next.js app and reach a PostgreSQL
database with `pgvector` — Vercel + Neon, Fly.io, a VPS with Docker.

For Vercel + Neon: enable `vector` on the Neon project
(`CREATE EXTENSION vector;`), run `npm run db:migrate` once against the
**direct** endpoint, then set `DATABASE_URL` in Vercel to the **pooled**
endpoint so serverless functions do not exhaust connections.

## Stack

Next.js 15 (App Router, strict TypeScript) · PostgreSQL + pgvector via Drizzle
ORM · Vercel AI SDK · Tiptap · Tailwind CSS 4.

## Documentation

- [docs/demo.md](docs/demo.md) — a guided tour of every feature using the
  bundled public-domain corpus, with a reset between runs
  (también [en español](docs/demo.es.md)).
- [docs/architecture.md](docs/architecture.md) — how context is composed, the
  data model, and the reasoning behind the constraints.
- [CONTRIBUTING.md](CONTRIBUTING.md) — development setup and what kind of
  contributions fit.
- [ROADMAP.md](ROADMAP.md) — what is planned and what is deliberately excluded.

## Scripts

| Command | Purpose |
|---|---|
| `npm run dev` | Development server |
| `npm run build` | Production build |
| `npm run typecheck` | Type checking |
| `npm run lint` | ESLint |
| `npm test` | Vitest |
| `npm run db:migrate` | Apply migrations |
| `npm run db:studio` | Inspect the database |
| `npm run corpus:ingest` | Ingest a Markdown corpus |
| `npm run corpus:reset` | Wipe a corpus and re-ingest it from disk |
| `npm run demo:reset` | Reset the bundled demo corpus to its initial state |

## License

MIT — see [LICENSE](LICENSE).

The demo corpus under `examples/demo-corpus/` quotes *Don Quijote de la Mancha*
by Miguel de Cervantes, which is in the public domain.
