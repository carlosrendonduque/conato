# Demo walkthrough

A guided tour of what Conato does, using the bundled public-domain corpus.
Follow it to try the tool, or use it as a shot list when recording a
screencast.

Every section starts from the same clean state, so you can stop, restart or
re-record any part without the previous run leaving traces.

*Versión en español: [demo.es.md](demo.es.md)*

## Setup, once

```bash
npm install
docker compose up -d
npm run db:migrate
npm run corpus:ingest -- --dir ./examples/demo-corpus --slug demo --name "Demo Corpus"
npm run dev
```

## Reset, between takes

```bash
npm run demo:reset
```

This deletes every file of the `demo` corpus, along with its versions,
invocations, proposals, candidates and comments, then re-ingests the directory
from disk. Reload the browser afterwards.

It only ever touches the corpus named by `--slug`. For a corpus of your own:

```bash
npm run corpus:reset -- --dir /path/to/corpus --slug my-work
```

That form asks for confirmation before deleting; `demo:reset` passes `--yes`
because the demo corpus is disposable by definition.

---

## 1 · The editor

**Shows:** WYSIWYG Markdown, and that metadata stays out of the writing
surface.

1. Open `quijote/capitulo_08.es.md`.
2. Point out the word count in the header — **82 palabras** — and that the
   prose starts immediately. The file has six lines of YAML frontmatter
   (`title`, `kind`, `voice`, `act`, `order`, `lang`); none of it is on screen.
3. Type a sentence anywhere. The header goes from *guardado* to *sin guardar*
   to *guardado* on its own.
4. Use **B**, **I** and **H2** from the toolbar. The Markdown is real; the
   syntax stays hidden.

**The point:** you are editing a plain `.md` file that any other tool can open,
but you never see the punctuation of Markdown while writing.

---

## 2 · The five operations

**Shows:** the core loop — selection, operation, proposal.

1. Select `—¿Qué gigantes? —dijo Sancho Panza.`
2. Set the operation to **expand** and press **invocar**.
3. A proposal appears on the right, labelled with the operation and the model
   that produced it.

Each operation takes the same shape:

| Operation | Needs | Does |
|---|---|---|
| `expand` | a selection | longer, same voice and register |
| `contract` | a selection | shorter, nothing essential lost |
| `rewrite` | a selection | another way of saying it — no claim it is better |
| `continue` | a cursor, no selection | carries on from where the cursor sits |
| `free_prompt` | either | whatever you ask for |

There is no "improve". Improving implies the model deciding what is better,
which is the author's job. Ask for a specific change with `free_prompt`.

**Worth saying on camera:** the model never writes to the file. Everything it
returns is a proposal.

---

## 3 · Accept, discard, keep

**Shows:** what happens to a proposal afterwards.

1. With a proposal on screen, press **aceptar**. A diff appears: removals in
   red, additions in green.
2. Confirm. The text lands in the editor, exactly on the words that were
   selected, and a version is recorded.
3. Invoke again on the same selection and press **descartar**. It disappears.
4. Invoke a third time and press **guardar como candidato**. Switch to another
   file and come back: the candidate is still there. Proposals are per-session;
   candidates persist.

---

## 4 · Comparing models

**Shows:** why the panel accumulates instead of replacing.

1. Select a sentence, choose **rewrite**, invoke with **Claude Opus 5**.
2. Without changing the selection, switch the model to **Claude Sonnet 5** and
   invoke again.
3. Both answers are now in the panel, each labelled with its model. Read them
   side by side and accept one.

**The point:** one invocation at a time, by choice. Sending the same prompt to
every model at once produces four answers to compare and no reason to prefer
any of them. Conato's workflow is: ask, read, and only ask again if the first
answer did not satisfy.

---

## 5 · Context

**Shows:** why the proposals fit the work rather than sounding generic.

1. Open `meta/canon-manifest.md`. It lists three paths.
2. Open `meta/canon.es.md` and read the voice rules: *"Don Quijote habla en
   registro elevado; Sancho, en registro llano. Ese contraste no se suaviza."*
3. Go back to a chapter, select a line of Sancho's, and **expand**.

The proposal keeps Sancho's plain, proverb-heavy register, because three things
reached the model automatically: every document the manifest lists, injected
whole; passages from the rest of the corpus retrieved by similarity; and the
complete file being edited.

Editing the manifest changes what counts as canon on the very next invocation.
It is corpus data, not configuration.

---

## 6 · Versions and comments

**Shows:** that nothing is lost.

1. Open the **⋮** menu in the header and choose the history. Every save is
   there.
2. Tag one as a milestone with a label. It stands out in the list.
3. Restore an earlier version. The text rolls back.
4. Select a phrase and add a comment — *"verificar esta cita"*. It anchors to
   the text and lives in the comments panel.

Comments are private notes to yourself. The model does not see them.

---

## Recording notes

- Run `npm run demo:reset` and reload before each take.
- Invocations take a few seconds. Either keep the wait in — it is honest about
  what using this feels like — or cut on the button press.
- The interface is currently in Spanish. If you are narrating in English, the
  labels worth translating out loud are *invocar* (invoke), *aceptar* (accept),
  *descartar* (discard), *guardar como candidato* (keep as candidate) and
  *guardado* (saved).
- Each section stands alone, so they can be separate short clips rather than
  one long video.
