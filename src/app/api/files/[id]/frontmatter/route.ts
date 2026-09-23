import { and, eq, sql } from "drizzle-orm";
import { NextResponse } from "next/server";
import { z } from "zod";
import { replaceFrontmatter } from "@/lib/corpus/frontmatter";
import { db } from "@/lib/db/client";
import { files } from "@/lib/db/schema";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * Schema laxo: cada campo es opcional. Si no se manda, el frontmatter
 * queda como estaba para esa key. Para borrar una key formalmente todavía
 * no hay mecanismo (de momento basta con sobrescribir).
 */
const bodySchema = z.object({
  title: z.string().optional(),
  kind: z.string().optional(),
  act: z.number().int().nullable().optional(),
  order: z.number().int().nullable().optional(),
  voice: z.string().optional(),
});

export async function PATCH(
  req: Request,
  ctx: { params: Promise<{ id: string }> },
) {
  const { id } = await ctx.params;
  if (!z.string().uuid().safeParse(id).success) {
    return NextResponse.json({ error: "invalid_id" }, { status: 400 });
  }

  let raw: unknown;
  try {
    raw = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }
  const parsed = bodySchema.safeParse(raw);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "invalid_request", issues: parsed.error.flatten() },
      { status: 400 },
    );
  }

  // Construir el objeto de patch solo con los campos efectivamente
  // enviados. Los `undefined` los descartamos para no pisar con `null`.
  const patch: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(parsed.data)) {
    if (value !== undefined) patch[key] = value;
  }
  if (Object.keys(patch).length === 0) {
    return NextResponse.json({ error: "no_fields" }, { status: 400 });
  }

  // Reordenar dentro y entre actos cuando act/order cambien. La idea:
  // si se pone order=1 sobre una posición ocupada, todos los archivos
  // del mismo acto con order >= 1 se shiftan +1 para abrir espacio. Si
  // mueve un archivo a otro acto, cierra el gap en el viejo y abre
  // espacio en el nuevo. La obra es viva — insertar escenas en cualquier
  // lugar es operación de primera clase, no efecto de reescribir todos
  // los frontmatters a mano.
  const shiftedIds = new Set<string>();
  let result: { id: string; frontmatter: unknown } | null = null;

  await db.transaction(async (tx) => {
    const [current] = await tx.select().from(files).where(eq(files.id, id));
    if (!current) return;
    const currentFm = (current.frontmatter ?? {}) as Record<string, unknown>;
    const currentAct =
      typeof currentFm.act === "number" ? currentFm.act : null;
    const currentOrder =
      typeof currentFm.order === "number" ? currentFm.order : null;
    const targetAct =
      "act" in patch
        ? (patch.act as number | null)
        : currentAct;
    const targetOrder =
      "order" in patch
        ? (patch.order as number | null)
        : currentOrder;

    const orderChanged =
      "order" in patch && currentOrder !== targetOrder;
    const actChanged = "act" in patch && currentAct !== targetAct;

    if ((orderChanged || actChanged) && targetAct !== null && targetOrder !== null) {
      if (currentAct === targetAct && currentOrder !== null) {
        // Movimiento dentro del mismo acto.
        await reorderWithinAct(
          tx,
          current.corpusId,
          targetAct,
          id,
          currentOrder,
          targetOrder,
          shiftedIds,
        );
      } else {
        // Cambio de acto o primera asignación de orden.
        if (currentAct !== null && currentOrder !== null) {
          await closeGapInAct(
            tx,
            current.corpusId,
            currentAct,
            currentOrder,
            id,
            shiftedIds,
          );
        }
        await openSpaceInAct(
          tx,
          current.corpusId,
          targetAct,
          targetOrder,
          id,
          shiftedIds,
        );
      }
    }

    // El YAML dentro de `content` se reescribe junto con la columna: es
    // lo que se exporta a disco, así que dejarlo obsoleto sería metadata
    // perdida en cuanto alguien descargue el corpus.
    const mergedFm = { ...currentFm, ...patch } as Record<string, unknown>;
    const [updatedRow] = await tx
      .update(files)
      .set({
        frontmatter: sql`coalesce(${files.frontmatter}, '{}'::jsonb) || ${JSON.stringify(patch)}::jsonb`,
        content: replaceFrontmatter(current.content, mergedFm),
        updatedAt: new Date(),
      })
      .where(eq(files.id, id))
      .returning({ id: files.id, frontmatter: files.frontmatter });
    if (updatedRow) result = updatedRow;
  });

  if (!result) {
    return NextResponse.json({ error: "file_not_found" }, { status: 404 });
  }

  return NextResponse.json({
    id: (result as { id: string }).id,
    frontmatter: (result as { frontmatter: unknown }).frontmatter,
    shiftedCount: shiftedIds.size,
  });
}

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

/**
 * Mueve un archivo dentro del mismo acto: shifta los archivos cuya posición
 * está entre la vieja y la nueva para hacer espacio, sin colisionar.
 */
async function reorderWithinAct(
  tx: Tx,
  corpusId: string,
  act: number,
  fileId: string,
  oldOrder: number,
  newOrder: number,
  shifted: Set<string>,
): Promise<void> {
  if (oldOrder === newOrder) return;
  if (newOrder < oldOrder) {
    // Moviendo hacia atrás: archivos en [newOrder, oldOrder-1] suben +1.
    const rows = await tx
      .select({ id: files.id })
      .from(files)
      .where(
        and(
          eq(files.corpusId, corpusId),
          sql`(${files.frontmatter}->>'act')::int = ${act}`,
          sql`(${files.frontmatter}->>'order')::int >= ${newOrder}`,
          sql`(${files.frontmatter}->>'order')::int < ${oldOrder}`,
          sql`${files.id} != ${fileId}`,
        ),
      );
    for (const r of rows) shifted.add(r.id);
    await tx
      .update(files)
      .set({
        frontmatter: sql`jsonb_set(coalesce(${files.frontmatter}, '{}'::jsonb), '{order}', to_jsonb(((${files.frontmatter}->>'order')::int + 1)))`,
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(files.corpusId, corpusId),
          sql`(${files.frontmatter}->>'act')::int = ${act}`,
          sql`(${files.frontmatter}->>'order')::int >= ${newOrder}`,
          sql`(${files.frontmatter}->>'order')::int < ${oldOrder}`,
          sql`${files.id} != ${fileId}`,
        ),
      );
  } else {
    // Moviendo hacia adelante: archivos en (oldOrder, newOrder] bajan -1.
    const rows = await tx
      .select({ id: files.id })
      .from(files)
      .where(
        and(
          eq(files.corpusId, corpusId),
          sql`(${files.frontmatter}->>'act')::int = ${act}`,
          sql`(${files.frontmatter}->>'order')::int > ${oldOrder}`,
          sql`(${files.frontmatter}->>'order')::int <= ${newOrder}`,
          sql`${files.id} != ${fileId}`,
        ),
      );
    for (const r of rows) shifted.add(r.id);
    await tx
      .update(files)
      .set({
        frontmatter: sql`jsonb_set(coalesce(${files.frontmatter}, '{}'::jsonb), '{order}', to_jsonb(((${files.frontmatter}->>'order')::int - 1)))`,
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(files.corpusId, corpusId),
          sql`(${files.frontmatter}->>'act')::int = ${act}`,
          sql`(${files.frontmatter}->>'order')::int > ${oldOrder}`,
          sql`(${files.frontmatter}->>'order')::int <= ${newOrder}`,
          sql`${files.id} != ${fileId}`,
        ),
      );
  }
}

/**
 * Cuando un archivo sale de un acto, los que quedaron con order > su
 * order viejo se corren -1 para cerrar el hueco.
 */
async function closeGapInAct(
  tx: Tx,
  corpusId: string,
  act: number,
  oldOrder: number,
  fileId: string,
  shifted: Set<string>,
): Promise<void> {
  const rows = await tx
    .select({ id: files.id })
    .from(files)
    .where(
      and(
        eq(files.corpusId, corpusId),
        sql`(${files.frontmatter}->>'act')::int = ${act}`,
        sql`(${files.frontmatter}->>'order')::int > ${oldOrder}`,
        sql`${files.id} != ${fileId}`,
      ),
    );
  for (const r of rows) shifted.add(r.id);
  await tx
    .update(files)
    .set({
      frontmatter: sql`jsonb_set(coalesce(${files.frontmatter}, '{}'::jsonb), '{order}', to_jsonb(((${files.frontmatter}->>'order')::int - 1)))`,
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(files.corpusId, corpusId),
        sql`(${files.frontmatter}->>'act')::int = ${act}`,
        sql`(${files.frontmatter}->>'order')::int > ${oldOrder}`,
        sql`${files.id} != ${fileId}`,
      ),
    );
}

/**
 * Cuando un archivo entra a un acto en posición N, los que ya estaban
 * en order >= N se corren +1 para abrir espacio. Esto soporta inserción
 * en cualquier lugar — clave para edición creativa.
 */
async function openSpaceInAct(
  tx: Tx,
  corpusId: string,
  act: number,
  newOrder: number,
  fileId: string,
  shifted: Set<string>,
): Promise<void> {
  const rows = await tx
    .select({ id: files.id })
    .from(files)
    .where(
      and(
        eq(files.corpusId, corpusId),
        sql`(${files.frontmatter}->>'act')::int = ${act}`,
        sql`(${files.frontmatter}->>'order')::int >= ${newOrder}`,
        sql`${files.id} != ${fileId}`,
      ),
    );
  for (const r of rows) shifted.add(r.id);
  await tx
    .update(files)
    .set({
      frontmatter: sql`jsonb_set(coalesce(${files.frontmatter}, '{}'::jsonb), '{order}', to_jsonb(((${files.frontmatter}->>'order')::int + 1)))`,
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(files.corpusId, corpusId),
        sql`(${files.frontmatter}->>'act')::int = ${act}`,
        sql`(${files.frontmatter}->>'order')::int >= ${newOrder}`,
        sql`${files.id} != ${fileId}`,
      ),
    );
}
