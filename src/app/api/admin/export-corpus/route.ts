import JSZip from "jszip";
import { db } from "@/lib/db/client";
import { files } from "@/lib/db/schema";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 60;

/**
 * Exporta TODO el corpus como un ZIP con la estructura de carpetas
 * preservada y el frontmatter inyectado al inicio de cada `.md`. Pensado
 * como "guardar un respaldo manual ahora mismo en mi disco". El autor
 * descarga, lo guarda en iCloud / disco externo / donde quiera.
 *
 * Independiente del GitHub sync: este endpoint sirve incluso si el autor
 * no tiene Github configurado.
 */
export async function GET() {
  const all = await db.select().from(files);
  const zip = new JSZip();

  for (const f of all) {
    const fm = (f.frontmatter ?? {}) as Record<string, unknown>;
    const md = buildMarkdownWithFrontmatter(f.content, fm);
    zip.file(f.path, md);
  }

  const buffer = await zip.generateAsync({ type: "nodebuffer" });
  const stamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, "-");
  const filename = `conato-corpus-${stamp}.zip`;

  return new Response(new Uint8Array(buffer), {
    status: 200,
    headers: {
      "Content-Type": "application/zip",
      "Content-Disposition": `attachment; filename="${filename}"`,
      "Cache-Control": "no-store",
    },
  });
}

function buildMarkdownWithFrontmatter(
  content: string,
  frontmatter: Record<string, unknown>,
): string {
  const entries = Object.entries(frontmatter ?? {}).filter(
    ([, v]) =>
      v !== null &&
      v !== undefined &&
      (typeof v === "string" ||
        typeof v === "number" ||
        typeof v === "boolean"),
  );
  if (entries.length === 0) return content;
  const yamlLines = entries.map(([k, v]) => {
    if (typeof v === "string" && /[:#&*!|>'"%@`,\[\]\{\}]/.test(v)) {
      const escaped = v.replace(/"/g, '\\"');
      return `${k}: "${escaped}"`;
    }
    return `${k}: ${v}`;
  });
  return `---\n${yamlLines.join("\n")}\n---\n\n${content}`;
}
