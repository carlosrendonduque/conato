import { eq } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { chunks, files } from "@/lib/db/schema";
import { embedBatch } from "@/lib/llm/embeddings";
import { chunkMarkdown } from "./chunker";

// Hasta qué capa del corpus indexa el reindex masivo. v1 = "todo": el autor
// considera que documentación, plan y referencias son corpus también, y
// quiere que el modelo los pueda recuperar por similitud. Cuando agreguemos
// categorización fina (capítulos vs documentación), este filtro puede
// volver para excluir lo que no tenga sentido en RAG.

export interface IndexResult {
  fileId: string;
  path: string;
  chunksWritten: number;
}

/**
 * Reindexa un archivo: borra sus chunks viejos y escribe los nuevos. Es
 * idempotente — llamar dos veces deja la DB igual que llamar una vez.
 *
 * Se hace dentro de una transacción para que un fallo a mitad no deje
 * el archivo con chunks parciales.
 */
export async function indexFile(fileId: string): Promise<IndexResult> {
  const [file] = await db.select().from(files).where(eq(files.id, fileId));
  if (!file) throw new Error(`indexFile: file ${fileId} not found`);

  const newChunks = chunkMarkdown(file.content);

  if (newChunks.length === 0) {
    await db.delete(chunks).where(eq(chunks.fileId, fileId));
    return { fileId, path: file.path, chunksWritten: 0 };
  }

  const embeddings = await embedBatch(
    newChunks.map((c) => c.text),
    "document",
  );

  await db.transaction(async (tx) => {
    await tx.delete(chunks).where(eq(chunks.fileId, fileId));
    await tx.insert(chunks).values(
      newChunks.map((c, i) => ({
        fileId,
        chunkIndex: c.index,
        text: c.text,
        tokenCount: c.tokenCount,
        embedding: embeddings[i] as number[],
      })),
    );
  });

  return { fileId, path: file.path, chunksWritten: newChunks.length };
}

/**
 * Reindexa todos los archivos del corpus, sin filtrar por capa. Para
 * la obra, documentación/plan/referencias son corpus al igual
 * que los capítulos: el modelo se beneficia de poder recuperarlos por
 * similitud al escribir. Si más adelante hay material que no quiere
 * estar en RAG (notas privadas, drafts experimentales), agregamos un
 * flag de exclusión por archivo.
 */
export async function reindexCorpus(): Promise<{
  results: IndexResult[];
  totalChunks: number;
}> {
  const allFiles = await db.select({ id: files.id }).from(files);
  const results: IndexResult[] = [];
  for (const f of allFiles) {
    results.push(await indexFile(f.id));
  }
  const totalChunks = results.reduce((sum, r) => sum + r.chunksWritten, 0);
  return { results, totalChunks };
}
