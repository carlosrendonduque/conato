import { createHash } from "node:crypto";
import { desc, eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { z } from "zod";
import { splitFrontmatter } from "@/lib/corpus/frontmatter";
import { db } from "@/lib/db/client";
import { fileVersions, files, invocations } from "@/lib/db/schema";
import { invoke } from "@/lib/llm/invoke";
import { buildSystemPrompt } from "@/lib/llm/prompt";
import { loadCanonFirme } from "@/lib/llm/canon";
import { retrieveRelevantChunks } from "@/lib/rag/retrieval";
import {
  OPERATIONS,
  PROVIDER_IDS,
  type InvokeResponseBody,
} from "@/lib/llm/types";
import { DEFAULT_MODELS, type ProviderId } from "@/lib/llm/providers";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
// Las invocaciones a Opus con contexto rico superan los 10s del default
// de Vercel Hobby. 60s es el máximo en Hobby.
export const maxDuration = 60;

const requestSchema = z.object({
  fileId: z.string().uuid(),
  operation: z.enum(OPERATIONS),
  userPrompt: z.string().optional(),
  selection: z
    .object({
      text: z.string(),
      range: z.object({
        from: z.number().int().nonnegative(),
        to: z.number().int().nonnegative(),
      }),
    })
    .optional(),
  cursorPosition: z.number().int().nonnegative().optional(),
  provider: z.enum(PROVIDER_IDS).optional(),
  model: z.string().optional(),
});

const DEFAULT_PROVIDER: ProviderId = "anthropic";

function hashContent(content: string): string {
  return createHash("sha256").update(content, "utf8").digest("hex");
}

const RAG_CURSOR_WINDOW_CHARS = 400;

/**
 * Construye la query para RAG a partir del cuerpo de la invocación. Si
 * hay selección, esa es la query. Si no, una ventana de ~400 chars
 * centrada en el cursor para que el embedding tenga contexto suficiente.
 * Devuelve string vacío si no hay nada útil — retrieveRelevantChunks
 * trata el vacío como "no inyectar nada".
 */
function buildRagQuery(
  content: string,
  data: {
    selection?: { text: string } | undefined;
    cursorPosition?: number | undefined;
  },
): string {
  if (data.selection && data.selection.text.trim() !== "") {
    return data.selection.text;
  }
  if (typeof data.cursorPosition === "number") {
    const half = Math.floor(RAG_CURSOR_WINDOW_CHARS / 2);
    const start = Math.max(0, data.cursorPosition - half);
    const end = Math.min(content.length, data.cursorPosition + half);
    return content.slice(start, end);
  }
  return "";
}

export async function POST(req: Request) {
  let raw: unknown;
  try {
    raw = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }

  const parsed = requestSchema.safeParse(raw);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "invalid_request", issues: parsed.error.flatten() },
      { status: 400 },
    );
  }
  const data = parsed.data;

  if (
    data.operation === "free_prompt" &&
    (!data.userPrompt || data.userPrompt.trim() === "")
  ) {
    return NextResponse.json(
      { error: "user_prompt_required_for_free_prompt" },
      { status: 400 },
    );
  }
  if (
    (data.operation === "expand" ||
      data.operation === "contract" ||
      data.operation === "rewrite") &&
    (!data.selection || data.selection.text.trim() === "")
  ) {
    return NextResponse.json(
      { error: "selection_required", operation: data.operation },
      { status: 400 },
    );
  }
  if (data.operation === "continue" && data.cursorPosition === undefined) {
    return NextResponse.json(
      { error: "cursor_position_required", operation: data.operation },
      { status: 400 },
    );
  }

  const [file] = await db.select().from(files).where(eq(files.id, data.fileId));
  if (!file) {
    return NextResponse.json({ error: "file_not_found" }, { status: 404 });
  }

  // Toda invocación se ata a una versión inmutable del archivo. Si el archivo
  // todavía no tiene historial, creamos la primera versión a partir de su
  // contenido actual para servir de ancla.
  const [latestVersion] = await db
    .select()
    .from(fileVersions)
    .where(eq(fileVersions.fileId, file.id))
    .orderBy(desc(fileVersions.createdAt))
    .limit(1);

  let versionId: string;
  if (latestVersion) {
    versionId = latestVersion.id;
  } else {
    const [created] = await db
      .insert(fileVersions)
      .values({
        fileId: file.id,
        content: file.content,
        contentHash: hashContent(file.content),
        frontmatter: file.frontmatter,
      })
      .returning();
    if (!created) {
      return NextResponse.json(
        { error: "could_not_create_initial_version" },
        { status: 500 },
      );
    }
    versionId = created.id;
  }

  // Canon firme: archivos del manifiesto se inyectan ENTEROS como reglas
  // del mundo de la obra. Si el manifiesto no existe o está vacío,
  // se sigue sin canon — pero la calidad de la sugerencia degrada porque
  // el modelo deja de tener las reglas del mundo. Documentado en handoff §6.
  const canonFiles = await loadCanonFirme(file.corpusId).catch((err) => {
    console.error("[invoke] canon load failed, continuing without it", err);
    return [];
  });

  // RAG: recuperar fragmentos del corpus relacionados con la ubicación
  // de la operación. La query es la selección si existe, o una ventana
  // alrededor del cursor; ambas dan al embedding suficiente contexto
  // para hacer una búsqueda semántica útil.
  //
  // Pasamos contexto del archivo activo (voz, folder, acto) para que
  // retrieveRelevantChunks priorice chunks afines en empates de
  // similitud — al editar un personaje, sus chunks ganan en empates
  // de similitud comparable, sin bloquear chunks "lejanos" muy
  // relevantes. MMR aplicado por default para diversidad.
  // El cursor y la selección son offsets en el cuerpo, no en el archivo
  // crudo: el editor nunca ve el frontmatter.
  const { body: fileBody } = splitFrontmatter(file.content);
  const ragQuery = buildRagQuery(fileBody, data);
  const fileFm = (file.frontmatter ?? {}) as Record<string, unknown>;
  const ragContext = {
    voice: typeof fileFm.voice === "string" ? fileFm.voice : undefined,
    folder: file.path.includes("/") ? file.path.split("/")[0] : undefined,
    act: typeof fileFm.act === "number" ? fileFm.act : undefined,
  };
  const relevantChunks = await retrieveRelevantChunks(ragQuery, {
    excludeFileId: file.id,
    context: ragContext,
    useMMR: true,
  }).catch((err) => {
    console.error("[invoke] retrieval failed, continuing without RAG", err);
    return [];
  });

  const systemPrompt = await buildSystemPrompt({
    activeFile: file,
    operation: data.operation,
    userPrompt: data.userPrompt ?? null,
    selection: data.selection ?? null,
    cursorPosition: data.cursorPosition ?? null,
    canonFiles,
    relevantChunks,
  });

  const provider: ProviderId = data.provider ?? DEFAULT_PROVIDER;
  const requestedModel = data.model ?? DEFAULT_MODELS[provider];
  const startedAt = Date.now();
  const userMessage =
    data.userPrompt && data.userPrompt.trim() !== ""
      ? data.userPrompt
      : "Procede con la operación indicada según el contexto y la ubicación.";
  let result;
  try {
    result = await invoke({
      provider,
      model: requestedModel,
      system: systemPrompt,
      messages: [{ role: "user", content: userMessage }],
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[invoke] LLM call failed", { provider, model: requestedModel, message });
    return NextResponse.json(
      { error: "llm_call_failed", provider, model: requestedModel, detail: message },
      { status: 502 },
    );
  }
  const latencyMs = Date.now() - startedAt;

  const [inv] = await db
    .insert(invocations)
    .values({
      fileId: file.id,
      fileVersionId: versionId,
      operation: data.operation,
      userPrompt: data.userPrompt ?? "",
      selectionText: data.selection?.text ?? null,
      // Convención: para `continue`, el cursor se guarda como un rango de
      // longitud cero ({from: pos, to: pos}) para que el endpoint de accept
      // sepa dónde insertar sin necesidad de una columna aparte.
      selectionRange: data.selection
        ? {
            from: data.selection.range.from,
            to: data.selection.range.to,
          }
        : data.cursorPosition !== undefined
          ? { from: data.cursorPosition, to: data.cursorPosition }
          : null,
      provider,
      model: result.model,
      systemPrompt,
      responseText: result.text,
      promptTokens: result.usage.promptTokens,
      completionTokens: result.usage.completionTokens,
      latencyMs,
      retrievedChunks: relevantChunks.map((c) => ({
        path: c.filePath,
        similarity: c.similarity,
      })),
    })
    .returning();
  if (!inv) {
    return NextResponse.json(
      { error: "could_not_persist_invocation" },
      { status: 500 },
    );
  }

  const response: InvokeResponseBody = {
    invocationId: inv.id,
    responseText: result.text,
    provider,
    model: result.model,
    usage: result.usage,
  };
  return NextResponse.json(response);
}
