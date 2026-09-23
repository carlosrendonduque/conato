import { describe, expect, it } from "vitest";
import {
  FILE_KINDS,
  FILE_REGISTERS,
  normalizeCorpusPath,
  parseFileName,
  pickEnum,
  resolveLanguage,
} from "../src/lib/corpus/conventions";

describe("parseFileName", () => {
  it("splits the <base>.<lang>.md convention", () => {
    expect(parseFileName("chapter_01.es.md", "en")).toEqual({
      baseName: "chapter_01",
      language: "es",
    });
  });

  it("falls back to the given language when none is encoded", () => {
    expect(parseFileName("notes.md", "en")).toEqual({
      baseName: "notes",
      language: "en",
    });
  });

  it("only treats a two-letter segment as a language code", () => {
    expect(parseFileName("notes.draft.md", "en")).toEqual({
      baseName: "notes.draft",
      language: "en",
    });
  });

  it("keeps dots inside the base name", () => {
    expect(parseFileName("act.1.scene.2.es.md", "en")).toEqual({
      baseName: "act.1.scene.2",
      language: "es",
    });
  });

  it("handles a name that is only a language segment", () => {
    // "es.md" has no base before the language, so the stem stays whole
    // rather than producing an empty base name.
    expect(parseFileName("es.md", "en").baseName).not.toBe("");
  });
});

describe("pickEnum", () => {
  it("accepts a permitted value", () => {
    expect(pickEnum("scene", FILE_KINDS)).toBe("scene");
    expect(pickEnum("screenplay", FILE_REGISTERS)).toBe("screenplay");
  });

  it("rejects a value outside the set, protecting the DB constraint", () => {
    expect(pickEnum("chapter", FILE_KINDS)).toBeUndefined();
    expect(pickEnum("prose", FILE_REGISTERS)).toBeUndefined();
  });

  it("rejects non-string frontmatter values", () => {
    for (const value of [42, null, undefined, {}, ["scene"], true]) {
      expect(pickEnum(value, FILE_KINDS)).toBeUndefined();
    }
  });

  it("is case sensitive", () => {
    expect(pickEnum("Scene", FILE_KINDS)).toBeUndefined();
  });
});

describe("resolveLanguage", () => {
  it("prefers the frontmatter lang key", () => {
    expect(resolveLanguage({ lang: "en" }, "es")).toBe("en");
  });

  it("accepts language as an alias for lang", () => {
    expect(resolveLanguage({ language: "fr" }, "es")).toBe("fr");
  });

  it("falls back to the filename when frontmatter declares nothing", () => {
    expect(resolveLanguage({}, "es")).toBe("es");
  });

  it("falls back when the declared value is empty or not a string", () => {
    expect(resolveLanguage({ lang: "" }, "es")).toBe("es");
    expect(resolveLanguage({ lang: 42 }, "es")).toBe("es");
    expect(resolveLanguage({ lang: null }, "es")).toBe("es");
  });
});

describe("normalizeCorpusPath", () => {
  it("leaves a posix path unchanged", () => {
    expect(normalizeCorpusPath("character/diary.es.md", "/")).toBe(
      "character/diary.es.md",
    );
  });

  it("converts windows separators so corpora match across platforms", () => {
    expect(normalizeCorpusPath("character\\diary.es.md", "\\")).toBe(
      "character/diary.es.md",
    );
  });

  it("strips leading slashes so paths stay relative", () => {
    expect(normalizeCorpusPath("/character/diary.es.md", "/")).toBe(
      "character/diary.es.md",
    );
  });

  it("handles a bare filename", () => {
    expect(normalizeCorpusPath("diary.es.md", "/")).toBe("diary.es.md");
  });
});
