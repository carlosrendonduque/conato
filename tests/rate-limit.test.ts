import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  clientKey,
  rateLimit,
  resetRateLimit,
} from "../src/lib/rate-limit";

/**
 * The login gate is a single shared secret, so these limits are what stand
 * between an attacker and unlimited guesses. They are worth pinning down.
 */
describe("rateLimit", () => {
  let counter = 0;
  // Each test uses a fresh key, since the limiter keeps module-level state.
  const key = () => `test-key-${counter}`;

  beforeEach(() => {
    counter += 1;
  });

  afterEach(() => {
    vi.useRealTimers();
    resetRateLimit(key());
  });

  it("allows attempts up to the limit", () => {
    for (let i = 0; i < 5; i++) {
      expect(rateLimit(key(), 5).allowed).toBe(true);
    }
  });

  it("blocks the attempt after the limit is exceeded", () => {
    for (let i = 0; i < 5; i++) rateLimit(key(), 5);
    const result = rateLimit(key(), 5);
    expect(result.allowed).toBe(false);
    expect(result.retryAfter).toBeGreaterThan(0);
  });

  it("keeps blocking once over the limit", () => {
    for (let i = 0; i < 8; i++) rateLimit(key(), 5);
    expect(rateLimit(key(), 5).allowed).toBe(false);
  });

  it("counts each key independently", () => {
    for (let i = 0; i < 5; i++) rateLimit(`${key()}-a`, 5);
    expect(rateLimit(`${key()}-a`, 5).allowed).toBe(false);
    expect(rateLimit(`${key()}-b`, 5).allowed).toBe(true);
    resetRateLimit(`${key()}-a`);
    resetRateLimit(`${key()}-b`);
  });

  it("allows attempts again once the window has elapsed", () => {
    vi.useFakeTimers();
    const windowMs = 1000;
    for (let i = 0; i < 5; i++) rateLimit(key(), 5, windowMs);
    expect(rateLimit(key(), 5, windowMs).allowed).toBe(false);

    vi.advanceTimersByTime(windowMs + 1);
    expect(rateLimit(key(), 5, windowMs).allowed).toBe(true);
  });

  it("reports retryAfter in seconds, not milliseconds", () => {
    vi.useFakeTimers();
    const windowMs = 60_000;
    for (let i = 0; i < 5; i++) rateLimit(key(), 5, windowMs);
    const { retryAfter } = rateLimit(key(), 5, windowMs);
    expect(retryAfter).toBeGreaterThan(0);
    expect(retryAfter).toBeLessThanOrEqual(60);
  });
});

describe("resetRateLimit", () => {
  it("clears the counter so a successful login does not penalise the user", () => {
    const key = "reset-test";
    for (let i = 0; i < 10; i++) rateLimit(key, 3);
    expect(rateLimit(key, 3).allowed).toBe(false);

    resetRateLimit(key);
    expect(rateLimit(key, 3).allowed).toBe(true);
    resetRateLimit(key);
  });
});

describe("clientKey", () => {
  const withHeaders = (headers: Record<string, string>) =>
    new Request("http://localhost/api/auth/login", { headers });

  it("uses the first entry of x-forwarded-for", () => {
    const req = withHeaders({ "x-forwarded-for": "203.0.113.5, 70.41.3.18" });
    expect(clientKey(req)).toBe("203.0.113.5");
  });

  it("trims whitespace around the forwarded address", () => {
    const req = withHeaders({ "x-forwarded-for": "  203.0.113.5  , 10.0.0.1" });
    expect(clientKey(req)).toBe("203.0.113.5");
  });

  it("falls back to x-real-ip", () => {
    const req = withHeaders({ "x-real-ip": "198.51.100.7" });
    expect(clientKey(req)).toBe("198.51.100.7");
  });

  it("falls back to a constant when no proxy headers are present", () => {
    expect(clientKey(withHeaders({}))).toBe("unknown");
  });

  it("does not return an empty key for a malformed header", () => {
    const req = withHeaders({ "x-forwarded-for": "" });
    expect(clientKey(req)).toBe("unknown");
  });
});
