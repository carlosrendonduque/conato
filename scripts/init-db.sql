-- Runs once, the first time the postgres volume is created.
-- Conato stores embeddings in a pgvector column, so the extension must exist
-- before migrations run.
CREATE EXTENSION IF NOT EXISTS vector;
