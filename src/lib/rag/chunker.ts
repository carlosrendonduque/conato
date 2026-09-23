/**
 * Chunking de Markdown para RAG. Para prosa literaria (la obra),
 * el párrafo natural — bloques separados por una o más líneas en blanco —
 * es la unidad que mejor preserva contexto sin fragmentar de más.
 *
 * Ignoramos chunks demasiado cortos (<20 chars) para no embebar palabras
 * sueltas que no aportan recall. Encabezados (#, ##) sí cuentan: aunque
 * cortos, ayudan a recuperar el archivo completo cuando coinciden con el
 * tema de la consulta.
 */

export interface Chunk {
  index: number;
  text: string;
  tokenCount: number;
}

const MIN_CHUNK_LENGTH = 20;

export function chunkMarkdown(content: string): Chunk[] {
  const blocks = content.split(/\n{2,}/).map((b) => b.trim());
  const chunks: Chunk[] = [];
  let index = 0;
  for (const block of blocks) {
    if (block.length < MIN_CHUNK_LENGTH && !block.startsWith("#")) continue;
    chunks.push({
      index,
      text: block,
      tokenCount: estimateTokens(block),
    });
    index += 1;
  }
  return chunks;
}

/**
 * Heurística rápida: ~4 chars por token para prosa en español/inglés. La
 * columna `token_count` es informativa, no se usa para enrutar; si hace
 * falta precisión, swap por un tokenizer real.
 */
function estimateTokens(text: string): number {
  return Math.max(1, Math.ceil(text.length / 4));
}
