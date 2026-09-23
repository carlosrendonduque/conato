import { waitUntil } from "@vercel/functions";
import { indexFile } from "./indexer";

/**
 * Programa un reindex del archivo en background. Usa `waitUntil` de
 * Vercel para extender la vida de la función serverless más allá del
 * response — el cliente recibe la respuesta del save / accept / etc.
 * sin esperar a que Voyage embeba (1-3s).
 *
 * Si el reindex falla, log y sigue: la fuente de verdad es
 * `files.content`, los chunks son derivables. El botón "reindex"
 * manual queda como fallback.
 *
 * Pensado para invocarse desde cualquier endpoint que muta
 * `files.content`: save, create, accept, apply candidate, restore,
 * ingesta masiva. Rename y delete no necesitan — rename no cambia
 * contenido, delete cascadea chunks vía FK.
 */
export function scheduleAutoReindex(fileId: string): void {
  waitUntil(
    indexFile(fileId).catch((err) => {
      const message = err instanceof Error ? err.message : String(err);
      console.error("[auto-reindex] failed", { fileId, message });
    }),
  );
}
