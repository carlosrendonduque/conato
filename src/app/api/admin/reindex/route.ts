import { NextResponse } from "next/server";
import { reindexCorpus } from "@/lib/rag/indexer";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
// Embebar puede tardar varios segundos por archivo. Subir el límite por
// si el corpus crece. El default Hobby tope son 60s.
export const maxDuration = 60;

export async function POST() {
  try {
    const { results, totalChunks } = await reindexCorpus();
    return NextResponse.json({
      filesIndexed: results.length,
      totalChunks,
      results: results.map((r) => ({
        path: r.path,
        chunks: r.chunksWritten,
      })),
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[reindex] failed", message);
    return NextResponse.json(
      { error: "reindex_failed", detail: message },
      { status: 500 },
    );
  }
}
