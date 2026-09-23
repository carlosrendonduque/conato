import { describe, expect, it } from "vitest";
import { MANIFEST_PATH, MANIFEST_PATHS, parseManifest } from "../src/lib/llm/canon";

/**
 * The manifest decides which documents are paid for on every single
 * invocation, so its parsing rules are worth pinning down: a path silently
 * dropped here is canon the model never sees.
 */
describe("parseManifest", () => {
  it("reads markdown bullets as corpus paths", () => {
    expect(
      parseManifest("- meta/canon.md\n- character/protagonist.es.md"),
    ).toEqual(["meta/canon.md", "character/protagonist.es.md"]);
  });

  it("accepts the three bullet markers", () => {
    expect(parseManifest("- a.md\n* b.md\n+ c.md")).toEqual([
      "a.md",
      "b.md",
      "c.md",
    ]);
  });

  it("accepts bullets escaped by the markdown serializer", () => {
    // Tiptap escapes a leading dash as `\-` when Markdown is pasted as text,
    // so a manifest edited in the editor must still parse.
    expect(parseManifest("\\- meta/canon.md")).toEqual(["meta/canon.md"]);
  });

  it("ignores headings, prose and blank lines", () => {
    const content = [
      "# Firm canon manifest",
      "",
      "Everything below is injected whole.",
      "",
      "- meta/canon.md",
      "",
      "Keep the list short.",
    ].join("\n");
    expect(parseManifest(content)).toEqual(["meta/canon.md"]);
  });

  it("preserves the author's order", () => {
    expect(parseManifest("- z.md\n- a.md\n- m.md")).toEqual([
      "z.md",
      "a.md",
      "m.md",
    ]);
  });

  it("de-duplicates repeated paths", () => {
    expect(parseManifest("- a.md\n- b.md\n- a.md")).toEqual(["a.md", "b.md"]);
  });

  it("tolerates surrounding whitespace", () => {
    expect(parseManifest("   -    meta/canon.md   ")).toEqual([
      "meta/canon.md",
    ]);
  });

  it("returns nothing for an empty or bullet-less manifest", () => {
    expect(parseManifest("")).toEqual([]);
    expect(parseManifest("# Heading\n\nJust prose.")).toEqual([]);
  });

  it("does not treat a bare dash as a path", () => {
    expect(parseManifest("-\n-   ")).toEqual([]);
  });
});

describe("manifest paths", () => {
  it("prefers the language-neutral path for new corpora", () => {
    expect(MANIFEST_PATH).toBe("meta/canon-manifest.md");
    expect(MANIFEST_PATHS[0]).toBe(MANIFEST_PATH);
  });

  it("still recognises the legacy path for older corpora", () => {
    expect(MANIFEST_PATHS).toContain("meta/manifiesto_canon_firme.es.md");
  });
});
