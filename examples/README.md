# Examples

## Demo corpus

A tiny corpus so you can run Conato without having a body of work of your own
yet. It exists to show the conventions, not to be interesting.

The prose fragments are excerpts from Miguel de Cervantes' *Don Quijote de la
Mancha* (1605), which is in the **public domain**. The `meta/` and
`personaje/` documents were written for this repository and are covered by the
project's MIT license.

Ingest it with:

```bash
npm run corpus:ingest -- --dir ./examples/demo-corpus --slug demo --name "Demo Corpus"
```

## What it demonstrates

- **Folder-per-voice/section** layout (`quijote/`, `personaje/`, `meta/`).
- The **`<base>.<lang>.md`** file naming convention.
- **YAML frontmatter** carrying `title`, `kind`, `voice`, `act` and `order`,
  which Conato reads to build the narrative index and to give the model
  context about the active file.
- **`meta/canon-manifest.md`**, the manifest that decides which documents are
  injected whole into every prompt instead of being retrieved by similarity.
  Here it lists the canon document and the two character sheets, so you can see
  the `# Canon firme` section appear in the composed prompt.
