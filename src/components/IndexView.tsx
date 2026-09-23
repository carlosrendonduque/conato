"use client";

import type { FileSummary } from "@/components/Editor";

interface IndexViewProps {
  files: FileSummary[];
  activeId: string | null;
  onSelectFile: (id: string) => void;
}

const ROMAN: Record<number, string> = {
  1: "I",
  2: "II",
  3: "III",
  4: "IV",
  5: "V",
  6: "VI",
  7: "VII",
  8: "VIII",
  9: "IX",
  10: "X",
};

/**
 * Vista del corpus en orden narrativo. Agrupa archivos con `kind`
 * narrativo (escena/capitulo/monologo/cierre) o con act+order definidos
 * por su `act`, los ordena por `order` ascendente, y presenta un
 * índice navegable estilo "tabla de capítulos".
 *
 * Archivos sin metadata narrativa no aparecen acá. Para verlos /
 * gestionarlos, se cambia al sidebar tree.
 */
export function IndexView({ files, activeId, onSelectFile }: IndexViewProps) {
  const narrative = files
    .filter(
      (f) =>
        (f.kind && ["escena", "capitulo", "monologo", "cierre"].includes(f.kind)) ||
        (f.act !== undefined && f.order !== undefined),
    )
    .sort((a, b) => {
      const ad =
        (a.act ?? Number.MAX_SAFE_INTEGER) -
        (b.act ?? Number.MAX_SAFE_INTEGER);
      if (ad !== 0) return ad;
      const od =
        (a.order ?? Number.MAX_SAFE_INTEGER) -
        (b.order ?? Number.MAX_SAFE_INTEGER);
      if (od !== 0) return od;
      return a.path.localeCompare(b.path);
    });

  if (narrative.length === 0) {
    return (
      <p className="text-xs text-neutral-400">
        Sin archivos narrativos todavía. Para que aparezcan acá, agrega{" "}
        <code>act: N</code>, <code>order: N</code> y{" "}
        <code>kind: escena</code> al frontmatter de cada escena.
      </p>
    );
  }

  // Agrupar por act preservando orden.
  const groups = new Map<number | "sin_acto", FileSummary[]>();
  for (const f of narrative) {
    const key = f.act !== undefined ? f.act : "sin_acto";
    const arr = groups.get(key) ?? [];
    arr.push(f);
    groups.set(key, arr);
  }

  return (
    <div className="space-y-4">
      {Array.from(groups.entries()).map(([act, items]) => (
        <section key={String(act)}>
          <h3 className="mb-1.5 text-[11px] font-semibold uppercase tracking-wide text-neutral-500">
            {act === "sin_acto"
              ? "Sin acto definido"
              : `Acto ${ROMAN[act as number] ?? act}`}
          </h3>
          <ul className="space-y-0.5">
            {items.map((f) => {
              const isActive = activeId === f.id;
              const filename = f.path.split("/").pop() ?? f.path;
              const display = f.title ?? filename;
              return (
                <li key={f.id}>
                  <button
                    type="button"
                    onClick={() => onSelectFile(f.id)}
                    className={`block w-full truncate rounded px-2 py-2 text-left text-sm md:py-1 ${
                      isActive ? "bg-neutral-200" : "hover:bg-neutral-100"
                    }`}
                  >
                    {f.order !== undefined && (
                      <span className="mr-1.5 text-[11px] text-neutral-400">
                        {String(f.order).padStart(2, "0")}
                      </span>
                    )}
                    <span className="font-serif">{display}</span>
                    {f.voice && (
                      <span className="ml-2 text-[11px] text-neutral-400">
                        · {f.voice}
                      </span>
                    )}
                  </button>
                </li>
              );
            })}
          </ul>
        </section>
      ))}
    </div>
  );
}
