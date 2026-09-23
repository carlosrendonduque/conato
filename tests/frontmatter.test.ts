import { describe, expect, it } from "vitest";
import {
  joinFrontmatter,
  replaceFrontmatter,
  splitFrontmatter,
} from "../src/lib/corpus/frontmatter";

const DOC = `---
title: "De la condición y ejercicio del famoso hidalgo"
kind: scene
voice: narrador
act: 1
order: 1
lang: es
---

En un lugar de la Mancha, de cuyo nombre no quiero acordarme.
`;

/**
 * These guard a data-loss bug: Markdown reads `---` + text + `---` as a
 * horizontal rule followed by a setext heading, so feeding frontmatter to the
 * WYSIWYG editor made it serialize back as
 * `## title: "..." kind: scene voice: ...` — every field collapsed into one
 * heading string, destroyed on the first auto-save. The editor must only ever
 * see the body.
 */
describe("splitFrontmatter", () => {
  it("separates the frontmatter block from the body", () => {
    const { frontmatter, body } = splitFrontmatter(DOC);
    expect(frontmatter.startsWith("---\ntitle:")).toBe(true);
    expect(frontmatter.endsWith("---")).toBe(true);
    expect(body.trim()).toBe(
      "En un lugar de la Mancha, de cuyo nombre no quiero acordarme.",
    );
  });

  it("keeps every field of the block verbatim", () => {
    const { frontmatter } = splitFrontmatter(DOC);
    for (const field of ["kind: scene", "voice: narrador", "act: 1", "order: 1", "lang: es"]) {
      expect(frontmatter).toContain(field);
    }
  });

  it("returns the whole document as body when there is no frontmatter", () => {
    const plain = "Just prose.\n\nMore prose.\n";
    expect(splitFrontmatter(plain)).toEqual({ frontmatter: "", body: plain });
  });

  it("does not treat a horizontal rule mid-document as frontmatter", () => {
    const withRule = "Some prose.\n\n---\n\nMore prose.\n";
    expect(splitFrontmatter(withRule).frontmatter).toBe("");
  });

  it("requires the opening fence on the very first line", () => {
    const indented = "\n---\ntitle: x\n---\n\nBody.\n";
    expect(splitFrontmatter(indented).frontmatter).toBe("");
  });

  it("handles an unterminated block as plain body rather than eating the file", () => {
    const broken = "---\ntitle: x\n\nBody that never closes the fence.\n";
    expect(splitFrontmatter(broken)).toEqual({
      frontmatter: "",
      body: broken,
    });
  });

  it("handles CRLF line endings", () => {
    const crlf = "---\r\ntitle: x\r\n---\r\n\r\nBody.\r\n";
    const { frontmatter, body } = splitFrontmatter(crlf);
    expect(frontmatter).toContain("title: x");
    expect(body.trim()).toBe("Body.");
  });

  it("handles an empty frontmatter block", () => {
    const { frontmatter, body } = splitFrontmatter("---\n\n---\n\nBody.\n");
    expect(frontmatter).toBe("---\n\n---");
    expect(body.trim()).toBe("Body.");
  });
});

describe("joinFrontmatter", () => {
  it("round-trips a document unchanged", () => {
    const { frontmatter, body } = splitFrontmatter(DOC);
    expect(joinFrontmatter(frontmatter, body)).toBe(DOC);
  });

  it("survives repeated round trips", () => {
    let doc = DOC;
    for (let i = 0; i < 5; i++) {
      const { frontmatter, body } = splitFrontmatter(doc);
      doc = joinFrontmatter(frontmatter, body);
    }
    expect(doc).toBe(DOC);
  });

  it("re-attaches the block after the body was edited", () => {
    const { frontmatter } = splitFrontmatter(DOC);
    const rejoined = joinFrontmatter(frontmatter, "Texto nuevo del autor.\n");
    expect(splitFrontmatter(rejoined).frontmatter).toBe(frontmatter);
    expect(splitFrontmatter(rejoined).body.trim()).toBe(
      "Texto nuevo del autor.",
    );
  });

  it("returns the body untouched when there is no frontmatter", () => {
    expect(joinFrontmatter("", "Just prose.\n")).toBe("Just prose.\n");
  });

  it("does not accumulate blank lines when the body already starts with one", () => {
    const { frontmatter } = splitFrontmatter(DOC);
    const once = joinFrontmatter(frontmatter, "\n\n\nBody.\n");
    expect(once).toBe(`${frontmatter}\n\nBody.\n`);
  });

  it("produces output that splits back identically", () => {
    const { frontmatter } = splitFrontmatter(DOC);
    const joined = joinFrontmatter(frontmatter, "Body.\n");
    const again = splitFrontmatter(joined);
    expect(again.frontmatter).toBe(frontmatter);
    expect(again.body).toBe("Body.\n");
  });
});

describe("replaceFrontmatter", () => {
  it("rewrites the block and leaves the body untouched", () => {
    const out = replaceFrontmatter(DOC, {
      title: "Nuevo título",
      kind: "scene",
      act: 2,
    });
    const { frontmatter, body } = splitFrontmatter(out);
    expect(frontmatter).toContain('title: "Nuevo título"');
    expect(frontmatter).toContain("act: 2");
    expect(body.trim()).toBe(
      "En un lugar de la Mancha, de cuyo nombre no quiero acordarme.",
    );
  });

  it("drops fields that are no longer present", () => {
    const out = replaceFrontmatter(DOC, { title: "Solo esto" });
    expect(out).not.toContain("voice:");
    expect(out).not.toContain("act:");
  });

  it("emits numbers and booleans unquoted", () => {
    const out = replaceFrontmatter(DOC, { act: 3, share_external: true });
    expect(out).toContain("act: 3");
    expect(out).toContain("share_external: true");
  });

  it("quotes strings that would otherwise break the YAML", () => {
    const out = replaceFrontmatter(DOC, { title: "Capítulo 1: el principio" });
    expect(out).toContain('title: "Capítulo 1: el principio"');
  });

  it("quotes strings that would be read as another type", () => {
    for (const value of ["true", "false", "null", "123"]) {
      const out = replaceFrontmatter(DOC, { title: value });
      expect(out).toContain(`title: ${JSON.stringify(value)}`);
    }
  });

  it("adds a block to a document that had none", () => {
    const out = replaceFrontmatter("Just prose.\n", { title: "Añadido" });
    expect(splitFrontmatter(out).frontmatter).toContain('title: "Añadido"');
    expect(splitFrontmatter(out).body.trim()).toBe("Just prose.");
  });

  it("removes the block entirely when given no fields", () => {
    expect(replaceFrontmatter(DOC, {}).trim()).toBe(
      "En un lugar de la Mancha, de cuyo nombre no quiero acordarme.",
    );
  });

  it("produces output that splits cleanly again", () => {
    const out = replaceFrontmatter(DOC, { title: "X", act: 1 });
    const { frontmatter, body } = splitFrontmatter(out);
    expect(joinFrontmatter(frontmatter, body)).toBe(out);
  });
});
