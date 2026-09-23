import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import {
  constantTimeEqual,
  signSession,
  verifySession,
} from "../src/lib/auth-edge";

const SECRET = "test-cookie-secret-long-enough";

describe("session cookie", () => {
  let original: string | undefined;

  beforeAll(() => {
    original = process.env.CONATO_COOKIE_SECRET;
    process.env.CONATO_COOKIE_SECRET = SECRET;
  });

  afterAll(() => {
    if (original === undefined) delete process.env.CONATO_COOKIE_SECRET;
    else process.env.CONATO_COOKIE_SECRET = original;
    vi.useRealTimers();
  });

  it("accepts a cookie it just signed", async () => {
    expect(await verifySession(await signSession())).toBe(true);
  });

  it("rejects a tampered payload", async () => {
    const cookie = await signSession();
    const [, sig] = cookie.split(".");
    // Re-date the session far into the future while keeping the original
    // signature — the forgery an attacker would actually attempt.
    const forged = Buffer.from(
      JSON.stringify({ issued: Date.now() + 90 * 24 * 60 * 60 * 1000 }),
    ).toString("base64url");
    expect(await verifySession(`${forged}.${sig}`)).toBe(false);
  });

  it("rejects a tampered signature", async () => {
    const [payload, sig] = (await signSession()).split(".");
    const flipped = sig?.startsWith("A") ? `B${sig.slice(1)}` : `A${sig?.slice(1)}`;
    expect(await verifySession(`${payload}.${flipped}`)).toBe(false);
  });

  it("rejects malformed cookies", async () => {
    for (const bad of ["", "no-dot", "a.b.c", ".", "..", "!!!.???"]) {
      expect(await verifySession(bad)).toBe(false);
    }
  });

  it("rejects a cookie signed with a different secret", async () => {
    const cookie = await signSession();
    process.env.CONATO_COOKIE_SECRET = "a-completely-different-secret";
    const valid = await verifySession(cookie);
    process.env.CONATO_COOKIE_SECRET = SECRET;
    expect(valid).toBe(false);
  });

  it("rejects a cookie older than the 30-day TTL", async () => {
    const cookie = await signSession();
    vi.useFakeTimers();
    vi.setSystemTime(Date.now() + 31 * 24 * 60 * 60 * 1000);
    const valid = await verifySession(cookie);
    vi.useRealTimers();
    expect(valid).toBe(false);
  });

  it("still accepts a cookie just inside the TTL", async () => {
    const cookie = await signSession();
    vi.useFakeTimers();
    vi.setSystemTime(Date.now() + 29 * 24 * 60 * 60 * 1000);
    const valid = await verifySession(cookie);
    vi.useRealTimers();
    expect(valid).toBe(true);
  });
});

describe("constantTimeEqual", () => {
  it("matches identical strings", () => {
    expect(constantTimeEqual("hunter2hunter2", "hunter2hunter2")).toBe(true);
  });

  it("rejects different strings of equal length", () => {
    expect(constantTimeEqual("aaaaaaaa", "aaaaaaab")).toBe(false);
  });

  it("rejects strings of different length", () => {
    expect(constantTimeEqual("short", "considerably-longer")).toBe(false);
  });

  it("rejects a prefix of the expected value", () => {
    expect(constantTimeEqual("secret", "secretsauce")).toBe(false);
  });

  it("handles empty strings", () => {
    expect(constantTimeEqual("", "")).toBe(true);
    expect(constantTimeEqual("", "x")).toBe(false);
  });
});
