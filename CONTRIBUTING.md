# Contributing to Conato

Thanks for looking. Conato started as one author's writing tool, which shapes
what belongs here — please read [Scope](#scope) before investing time in
something large.

## Getting set up

Requirements: Node.js 22+ (`.nvmrc` pins it), Docker, and a Voyage API key if
you want to work on retrieval.

```bash
npm install
cp .env.example .env.local        # fill in the secrets
docker compose up -d
npm run db:migrate
npm run corpus:ingest -- --dir ./examples/demo-corpus --slug demo --name "Demo Corpus"
npm run dev
```

The bundled demo corpus is public-domain text, so you can develop against real
content without needing a body of work of your own.

Before opening a pull request:

```bash
npm run typecheck && npm run lint && npm test
```

CI runs the same three. `npm run format` applies Prettier.

## Scope

Conato is opinionated, and saying no to features is part of the design. Things
that are **deliberately absent** — an "improve" operation, broadcasting one
prompt to every model at once, inline completions while typing, real multi-user
auth, PDF/EPUB export — are listed with their reasoning in
[ROADMAP.md](ROADMAP.md) and [docs/architecture.md](docs/architecture.md).

If you want to build one of those anyway, open an issue first and make the
case. A rejected pull request is a worse outcome for you than a conversation.

**Good first contributions**: bug fixes, accessibility, English UI strings and
i18n scaffolding, retrieval quality, test coverage, and documentation.

**Adding an LLM provider** is wanted, with one condition: the pull request has
to include evidence that you ran all five operations against it and that the
proposals came back sensible. v0.1 ships Anthropic alone because it is the only
one that was verified — see [ROADMAP.md](ROADMAP.md).

## Conventions

- **Strict TypeScript.** No `any`, no `@ts-ignore`. If the types are fighting
  you, the design usually needs the change, not the type checker.
- **Server-side by default.** Anything that can run on the server does. The
  client stays thin. Provider API keys never reach the browser.
- **No browser storage.** No `localStorage`, `sessionStorage` or IndexedDB —
  persistence belongs in the database, so a session survives changing devices.
- **No premature abstraction.** One concrete implementation beats three layers
  of interface written for a second case that does not exist yet. Abstract when
  the second case arrives.
- **Boring dependencies.** If a library solves the problem well, use it. If it
  brings 80% you do not need, write the 20% you do. Justify significant new
  dependencies in the pull request.
- **Verified over almost-working.** A feature that cannot be demonstrated
  running is not ready. Several subsystems were removed before v0.1 for exactly
  this reason.
- **Corpus-agnostic.** Nothing in `src/` should know about any particular body
  of work. Anything work-specific belongs in configuration or in flags.

The UI strings are currently Spanish; code, comments in new files, commit
messages, and all documentation are English. Mixed-language comments in older
files are a known wart — see the i18n issue.

## Commits and pull requests

Commit messages follow [Conventional Commits](https://www.conventionalcommits.org/)
(`feat:`, `fix:`, `docs:`, `chore:`, `refactor:`, `test:`), optionally scoped —
`feat(rag): ...`.

Keep pull requests focused on one thing. Describe what changes and why; if it
touches the data model, the prompt composition, or the proposals panel, explain
the reasoning, because those are the load-bearing parts.

## Code of conduct

Participation is governed by [CODE_OF_CONDUCT.md](CODE_OF_CONDUCT.md).
