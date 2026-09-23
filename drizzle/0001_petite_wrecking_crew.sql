-- Migración a Voyage 3 Large: cambiar dimensión del vector de 1536 a 1024.
-- pgvector no admite cast implícito entre dimensiones distintas, así que
-- vaciamos la tabla, dropeamos el índice HNSW (que es dimension-specific),
-- alteramos el tipo y recreamos el índice. Los chunks se reconstruyen al
-- siguiente reindex desde la app.
TRUNCATE TABLE "chunks";
--> statement-breakpoint
DROP INDEX IF EXISTS "chunks_embedding_idx";
--> statement-breakpoint
ALTER TABLE "chunks" ALTER COLUMN "embedding" SET DATA TYPE vector(1024);
--> statement-breakpoint
CREATE INDEX "chunks_embedding_idx" ON "chunks" USING hnsw ("embedding" vector_cosine_ops);
