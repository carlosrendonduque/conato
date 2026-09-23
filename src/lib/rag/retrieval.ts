import { sql } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { embedOne } from "@/lib/llm/embeddings";

export interface RetrievedChunk {
  text: string;
  filePath: string;
  similarity: number;
}

interface RetrieveOptions {
  /** ID del archivo activo. Excluido de los resultados para no devolver
   *  chunks del propio archivo (ya va completo en el system prompt). */
  excludeFileId: string;
  topK?: number;
  /** Umbral de similitud coseno (1 - distancia). Solo se inyectan chunks
   *  con similitud por encima. */
  minSimilarity?: number;
  /** Frontmatter del archivo activo. Se usa para boost de afinidad —
   *  chunks de la misma voz / folder / acto que el archivo activo
   *  obtienen un sumando pequeño en el score, suficiente para romper
   *  empates sin bloquear chunks "lejanos" muy relevantes. */
  context?: {
    voice?: string | undefined;
    folder?: string | undefined;
    act?: number | undefined;
  };
  /** Si true (default), aplica MMR para diversidad: balancea similitud
   *  a la query con disimilitud entre chunks ya elegidos. Resultado:
   *  k chunks distintos en vez de k ecos del mismo párrafo. */
  useMMR?: boolean;
}

const DEFAULT_TOP_K = 5;
const DEFAULT_MIN_SIMILARITY = 0.3;
/** Boosts pequeños — la similitud coseno es [0,1], así que sumar 0.05
 *  significa "rompé empates pero no anules diferencias reales". */
const VOICE_BOOST = 0.05;
const FOLDER_BOOST = 0.03;
const ACT_BOOST = 0.02;
const MMR_LAMBDA = 0.7;

/**
 * Recupera los chunks más cercanos a `query` por similitud coseno usando
 * el índice HNSW de pgvector como primer corte (top-N candidatos), y
 * después en código aplica:
 *   1) Boost por metadata (mismo voice/folder/act que el archivo activo).
 *   2) MMR (opcional, default activo) para diversidad entre los k finales.
 *
 * Devuelve `[]` silenciosamente si la query es vacía o si embebar falla;
 * RAG es opcional, no debería romper el flujo de invocación.
 */
export async function retrieveRelevantChunks(
  query: string,
  options: RetrieveOptions,
): Promise<RetrievedChunk[]> {
  const trimmed = query.trim();
  if (trimmed.length === 0) return [];

  const topK = options.topK ?? DEFAULT_TOP_K;
  const minSimilarity = options.minSimilarity ?? DEFAULT_MIN_SIMILARITY;
  const useMMR = options.useMMR ?? true;
  const ctx = options.context ?? {};

  let embedding: number[];
  try {
    embedding = await embedOne(trimmed, "query");
  } catch {
    return [];
  }

  const vectorLiteral = `[${embedding.join(",")}]`;
  // Sacamos un pool más grande del HNSW si vamos a aplicar re-ranking en
  // código (boost + MMR). Si no, el topK directo del índice basta.
  const candidatePoolSize = useMMR ? Math.max(topK * 4, 20) : topK;

  const rows = await db.execute<{
    text: string;
    file_path: string;
    frontmatter: Record<string, unknown> | null;
    embedding: number[];
    similarity: number;
  }>(sql`
    SELECT
      c.text AS text,
      c.embedding AS embedding,
      f.path AS file_path,
      f.frontmatter AS frontmatter,
      1 - (c.embedding <=> ${vectorLiteral}::vector) AS similarity
    FROM chunks c
    JOIN files f ON f.id = c.file_id
    WHERE c.file_id != ${options.excludeFileId}
    ORDER BY c.embedding <=> ${vectorLiteral}::vector
    LIMIT ${candidatePoolSize}
  `);

  // Boost por metadata. Pequeño suficiente para romper empates sin
  // anular diferencias reales de similitud.
  type Boosted = {
    text: string;
    file_path: string;
    embedding: number[];
    similarity: number;
    boostedScore: number;
  };
  const boosted: Boosted[] = rows
    .filter((r) => r.similarity >= minSimilarity)
    .map((r) => {
      const fm = (r.frontmatter ?? {}) as Record<string, unknown>;
      let bonus = 0;
      if (ctx.voice && fm.voice === ctx.voice) bonus += VOICE_BOOST;
      if (ctx.folder && r.file_path.startsWith(`${ctx.folder}/`)) {
        bonus += FOLDER_BOOST;
      }
      if (ctx.act !== undefined && fm.act === ctx.act) bonus += ACT_BOOST;
      return {
        text: r.text,
        file_path: r.file_path,
        embedding: r.embedding,
        similarity: r.similarity,
        boostedScore: r.similarity + bonus,
      };
    })
    .sort((a, b) => b.boostedScore - a.boostedScore);

  if (boosted.length === 0) return [];

  const finalSet = useMMR
    ? applyMMR(boosted, topK, MMR_LAMBDA)
    : boosted.slice(0, topK);

  return finalSet.map((r) => ({
    text: r.text,
    filePath: r.file_path,
    similarity: r.similarity,
  }));
}

/**
 * Maximal Marginal Relevance: itera seleccionando el candidato que
 * maximiza `λ * relevancia - (1-λ) * max_similitud_a_seleccionados`.
 * Resultado: cobertura amplia con buena pertinencia, sin redundancia.
 *
 * λ alto (0.9) ≈ similitud pura. λ bajo (0.1) ≈ máxima diversidad.
 * 0.7 es un default razonable que prioriza relevancia pero penaliza
 * repetición visible.
 */
function applyMMR<
  T extends { embedding: number[]; boostedScore: number },
>(candidates: T[], k: number, lambda: number): T[] {
  const selected: T[] = [];
  const remaining = [...candidates];
  while (selected.length < k && remaining.length > 0) {
    let bestIdx = 0;
    let bestScore = -Infinity;
    for (let i = 0; i < remaining.length; i++) {
      const c = remaining[i];
      if (!c) continue;
      let maxSimToSel = 0;
      for (const s of selected) {
        const sim = cosineSim(c.embedding, s.embedding);
        if (sim > maxSimToSel) maxSimToSel = sim;
      }
      const score = lambda * c.boostedScore - (1 - lambda) * maxSimToSel;
      if (score > bestScore) {
        bestScore = score;
        bestIdx = i;
      }
    }
    const picked = remaining.splice(bestIdx, 1)[0];
    if (picked) selected.push(picked);
  }
  return selected;
}

function cosineSim(a: number[], b: number[]): number {
  const len = Math.min(a.length, b.length);
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (let i = 0; i < len; i++) {
    const ai = a[i] ?? 0;
    const bi = b[i] ?? 0;
    dot += ai * bi;
    na += ai * ai;
    nb += bi * bi;
  }
  if (na === 0 || nb === 0) return 0;
  return dot / (Math.sqrt(na) * Math.sqrt(nb));
}
