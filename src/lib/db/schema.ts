import { sql } from "drizzle-orm";
import {
  type AnyPgColumn,
  boolean,
  check,
  index,
  integer,
  jsonb,
  pgTable,
  real,
  text,
  timestamp,
  uniqueIndex,
  uuid,
  vector,
} from "drizzle-orm/pg-core";

const tsCol = (name: string) =>
  timestamp(name, { withTimezone: true, mode: "date" });

export const users = pgTable("users", {
  id: uuid("id").primaryKey().defaultRandom(),
  handle: text("handle").notNull().unique(),
  createdAt: tsCol("created_at").notNull().defaultNow(),
});

export const corpora = pgTable("corpora", {
  id: uuid("id").primaryKey().defaultRandom(),
  ownerId: uuid("owner_id")
    .notNull()
    .references(() => users.id, { onDelete: "restrict" }),
  slug: text("slug").notNull().unique(),
  name: text("name").notNull(),
  settings: jsonb("settings").notNull().default(sql`'{}'::jsonb`),
  createdAt: tsCol("created_at").notNull().defaultNow(),
  updatedAt: tsCol("updated_at")
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date()),
});

export const files = pgTable(
  "files",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    corpusId: uuid("corpus_id")
      .notNull()
      .references(() => corpora.id, { onDelete: "cascade" }),
    path: text("path").notNull(),
    baseName: text("base_name").notNull(),
    language: text("language").notNull(),
    extension: text("extension").notNull(),
    frontmatter: jsonb("frontmatter").notNull().default(sql`'{}'::jsonb`),
    content: text("content").notNull(),
    corpusLayer: text("corpus_layer").notNull(),
    // --- ejes del CanonNode (ADR-0003 / ADR-0006). Aditivos, defaulted. ---
    kind: text("kind"),
    register: text("register").notNull().default("narrative"),
    visibility: text("visibility").notNull().default("public"),
    knownBy: text("known_by")
      .array()
      .notNull()
      .default(sql`'{}'::text[]`),
    corruption: real("corruption").notNull().default(0),
    assetRef: text("asset_ref"),
    isCanonFirme: boolean("is_canon_firme").notNull().default(false),
    counterpartId: uuid("counterpart_id").references(
      (): AnyPgColumn => files.id,
      { onDelete: "set null" },
    ),
    createdAt: tsCol("created_at").notNull().defaultNow(),
    updatedAt: tsCol("updated_at")
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (t) => [
    uniqueIndex("files_corpus_path_uniq").on(t.corpusId, t.path),
    index("files_corpus_layer_idx").on(t.corpusId, t.corpusLayer),
    index("files_corpus_language_idx").on(t.corpusId, t.language),
    check(
      "files_corpus_layer_check",
      sql`${t.corpusLayer} in ('canon','production','meta')`,
    ),
    check(
      "files_kind_check",
      sql`${t.kind} is null or ${t.kind} in ('character','place','scene','fragment','poem','track','video','document','note','object')`,
    ),
    check(
      "files_register_check",
      sql`${t.register} in ('narrative','biography','screenplay','architecture','transmedia','notes')`,
    ),
    check(
      "files_visibility_check",
      sql`${t.visibility} in ('public','hidden','protected')`,
    ),
    check(
      "files_corruption_check",
      sql`${t.corruption} >= 0 and ${t.corruption} <= 1`,
    ),
  ],
);

export const fileVersions = pgTable(
  "file_versions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    fileId: uuid("file_id")
      .notNull()
      .references(() => files.id, { onDelete: "cascade" }),
    parentVersionId: uuid("parent_version_id").references(
      (): AnyPgColumn => fileVersions.id,
      { onDelete: "set null" },
    ),
    content: text("content").notNull(),
    contentHash: text("content_hash").notNull(),
    frontmatter: jsonb("frontmatter").notNull().default(sql`'{}'::jsonb`),
    isMilestone: boolean("is_milestone").notNull().default(false),
    milestoneLabel: text("milestone_label"),
    createdAt: tsCol("created_at").notNull().defaultNow(),
  },
  (t) => [
    index("file_versions_file_created_idx").on(t.fileId, t.createdAt.desc()),
    index("file_versions_milestone_idx")
      .on(t.fileId)
      .where(sql`${t.isMilestone}`),
  ],
);

export const comments = pgTable(
  "comments",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    fileId: uuid("file_id")
      .notNull()
      .references(() => files.id, { onDelete: "cascade" }),
    anchorMarkId: uuid("anchor_mark_id").notNull(),
    body: text("body").notNull(),
    // Anclaje al texto: el fragmento exacto seleccionado + un poco de
    // contexto antes y después para desambiguar cuando el quote aparece
    // varias veces en el archivo. Si el texto se reescribe y el quote
    // ya no se encuentra, el comentario queda "huérfano" — sigue
    // visible en el panel pero sin decoración en el editor.
    anchorQuote: text("anchor_quote").notNull().default(""),
    anchorPrefix: text("anchor_prefix").notNull().default(""),
    anchorSuffix: text("anchor_suffix").notNull().default(""),
    visibleToAi: boolean("visible_to_ai").notNull().default(false),
    resolvedAt: tsCol("resolved_at"),
    createdAt: tsCol("created_at").notNull().defaultNow(),
    updatedAt: tsCol("updated_at")
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (t) => [
    index("comments_file_idx").on(t.fileId),
    uniqueIndex("comments_anchor_uniq").on(t.anchorMarkId),
  ],
);

export const invocations = pgTable(
  "invocations",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    fileId: uuid("file_id")
      .notNull()
      .references(() => files.id, { onDelete: "cascade" }),
    fileVersionId: uuid("file_version_id")
      .notNull()
      .references(() => fileVersions.id, { onDelete: "cascade" }),
    operation: text("operation").notNull(),
    userPrompt: text("user_prompt").notNull().default(""),
    selectionText: text("selection_text"),
    selectionRange: jsonb("selection_range"),
    provider: text("provider").notNull(),
    model: text("model").notNull(),
    systemPrompt: text("system_prompt").notNull(),
    responseText: text("response_text").notNull(),
    status: text("status").notNull().default("proposed"),
    promptTokens: integer("prompt_tokens").notNull().default(0),
    completionTokens: integer("completion_tokens").notNull().default(0),
    latencyMs: integer("latency_ms").notNull().default(0),
    // Auditoría del retrieval: qué chunks del corpus se inyectaron al
    // system prompt de esta invocación. Permite diagnosticar sugerencias
    // raras ("¿el RAG trajo basura?", "¿tocó el archivo correcto?").
    retrievedChunks: jsonb("retrieved_chunks")
      .$type<Array<{ path: string; similarity: number }>>()
      .notNull()
      .default([]),
    createdAt: tsCol("created_at").notNull().defaultNow(),
    decidedAt: tsCol("decided_at"),
  },
  (t) => [
    index("invocations_file_created_idx").on(t.fileId, t.createdAt.desc()),
    index("invocations_provider_op_idx").on(t.provider, t.operation),
    check(
      "invocations_operation_check",
      sql`${t.operation} in ('expand','contract','rewrite','continue','free_prompt')`,
    ),
    check(
      "invocations_provider_check",
      sql`${t.provider} in ('anthropic','openai','google','deepseek')`,
    ),
    check(
      "invocations_status_check",
      sql`${t.status} in ('proposed','accepted','discarded','saved')`,
    ),
  ],
);

export const candidates = pgTable(
  "candidates",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    invocationId: uuid("invocation_id")
      .notNull()
      .unique()
      .references(() => invocations.id, { onDelete: "cascade" }),
    fileId: uuid("file_id")
      .notNull()
      .references(() => files.id, { onDelete: "cascade" }),
    note: text("note"),
    createdAt: tsCol("created_at").notNull().defaultNow(),
  },
  (t) => [index("candidates_file_idx").on(t.fileId)],
);

export const chunks = pgTable(
  "chunks",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    fileId: uuid("file_id")
      .notNull()
      .references(() => files.id, { onDelete: "cascade" }),
    chunkIndex: integer("chunk_index").notNull(),
    text: text("text").notNull(),
    tokenCount: integer("token_count").notNull(),
    embedding: vector("embedding", { dimensions: 1024 }).notNull(),
    createdAt: tsCol("created_at").notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("chunks_file_chunk_idx").on(t.fileId, t.chunkIndex),
    index("chunks_embedding_idx").using(
      "hnsw",
      t.embedding.op("vector_cosine_ops"),
    ),
  ],
);

// Grafo tipado del canon: aristas entre files (= nodos del canon). ADR-0006.
export type User = typeof users.$inferSelect;
export type NewUser = typeof users.$inferInsert;
export type Corpus = typeof corpora.$inferSelect;
export type NewCorpus = typeof corpora.$inferInsert;
export type File = typeof files.$inferSelect;
export type NewFile = typeof files.$inferInsert;
export type FileVersion = typeof fileVersions.$inferSelect;
export type NewFileVersion = typeof fileVersions.$inferInsert;
export type Comment = typeof comments.$inferSelect;
export type NewComment = typeof comments.$inferInsert;
export type Invocation = typeof invocations.$inferSelect;
export type NewInvocation = typeof invocations.$inferInsert;
export type Candidate = typeof candidates.$inferSelect;
export type NewCandidate = typeof candidates.$inferInsert;
export type Chunk = typeof chunks.$inferSelect;
export type NewChunk = typeof chunks.$inferInsert;
