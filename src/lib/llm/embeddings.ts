import { env } from "@/lib/env";

/**
 * Provider de embeddings para RAG. Voyage 3 Large: el más capaz hoy
 * disponible, recomendado por Anthropic, 1024 dimensiones. Se invoca por
 * HTTP directo (sin SDK) para mantener el footprint de deps mínimo.
 *
 * Voyage distingue entre input_type "document" (al indexar) e input_type
 * "query" (al recuperar). Usar el correcto en cada lado mejora la
 * calidad de retrieval — no es opcional.
 */
const VOYAGE_MODEL = "voyage-3-large";
const VOYAGE_ENDPOINT = "https://api.voyageai.com/v1/embeddings";

export const EMBEDDING_DIMENSIONS = 1024;

export type EmbeddingInputType = "document" | "query";

interface VoyageResponse {
  object: "list";
  data: Array<{
    object: "embedding";
    embedding: number[];
    index: number;
  }>;
  model: string;
  usage?: { total_tokens?: number };
}

async function callVoyage(
  inputs: string[],
  inputType: EmbeddingInputType,
): Promise<number[][]> {
  if (!env.VOYAGE_API_KEY) {
    throw new Error("VOYAGE_API_KEY missing");
  }
  const res = await fetch(VOYAGE_ENDPOINT, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${env.VOYAGE_API_KEY}`,
    },
    body: JSON.stringify({
      model: VOYAGE_MODEL,
      input: inputs,
      input_type: inputType,
    }),
  });
  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    throw new Error(`voyage embeddings ${res.status}: ${detail.slice(0, 200)}`);
  }
  const json = (await res.json()) as VoyageResponse;
  // El response trae los embeddings con `index`; los ordenamos por índice
  // para garantizar que correspondan al orden del input.
  return json.data
    .slice()
    .sort((a, b) => a.index - b.index)
    .map((d) => d.embedding);
}

export async function embedOne(
  text: string,
  inputType: EmbeddingInputType,
): Promise<number[]> {
  const [first] = await callVoyage([text], inputType);
  if (!first) throw new Error("voyage returned empty embeddings");
  return first;
}

export async function embedBatch(
  texts: string[],
  inputType: EmbeddingInputType,
): Promise<number[][]> {
  if (texts.length === 0) return [];
  return callVoyage(texts, inputType);
}
