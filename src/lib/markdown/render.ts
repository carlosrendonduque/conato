import MarkdownIt from "markdown-it";

/**
 * Renderiza Markdown a HTML para la vista pública `/editor/...`. Configurado
 * conservador: sin html embebido (xss safe), `breaks: false` para que la
 * convención literaria de doble salto = párrafo se respete, y `linkify`
 * activado para que URLs naked se vuelvan links sin que el autor tenga que
 * envolverlas en `[]()`.
 */
const md = new MarkdownIt({
  html: false,
  linkify: true,
  breaks: false,
  typographer: true,
});

export function renderMarkdown(source: string): string {
  return md.render(source);
}
