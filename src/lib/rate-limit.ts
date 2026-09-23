/**
 * Minimal in-process rate limiter for the login gate.
 *
 * Conato's access control is a single shared secret, so an unthrottled login
 * endpoint is an offline-speed guessing oracle against it. This caps how fast
 * a client can try.
 *
 * Deliberately dependency-free and in-memory: it protects a single-user app,
 * not a fleet. On a serverless host each instance keeps its own counters, so
 * treat the limit as best-effort defence in depth — the real protection is a
 * high-entropy `CONATO_ACCESS_SECRET`. If you deploy Conato somewhere that
 * deserves stronger guarantees, put a rate limiter in front of it.
 */

interface Attempt {
  count: number;
  /** Epoch ms when the current window expires. */
  resetAt: number;
}

const attempts = new Map<string, Attempt>();

/** Drop expired entries so the map cannot grow without bound. */
function sweep(now: number): void {
  for (const [key, attempt] of attempts) {
    if (attempt.resetAt <= now) attempts.delete(key);
  }
}

export interface RateLimitResult {
  allowed: boolean;
  /** Seconds until the caller may retry; 0 when allowed. */
  retryAfter: number;
}

/**
 * Records an attempt for `key` and reports whether it is allowed.
 *
 * @param limit   attempts permitted per window
 * @param windowMs length of the window in milliseconds
 */
export function rateLimit(
  key: string,
  limit = 10,
  windowMs = 15 * 60 * 1000,
): RateLimitResult {
  const now = Date.now();
  if (attempts.size > 1000) sweep(now);

  const existing = attempts.get(key);
  if (!existing || existing.resetAt <= now) {
    attempts.set(key, { count: 1, resetAt: now + windowMs });
    return { allowed: true, retryAfter: 0 };
  }

  existing.count += 1;
  if (existing.count > limit) {
    return {
      allowed: false,
      retryAfter: Math.ceil((existing.resetAt - now) / 1000),
    };
  }
  return { allowed: true, retryAfter: 0 };
}

/** Clears the counter for `key` — called after a successful login. */
export function resetRateLimit(key: string): void {
  attempts.delete(key);
}

/**
 * Best-effort client identity for rate limiting. Proxy headers are
 * spoofable, so this is a throttle, not an authorization decision.
 */
export function clientKey(req: Request): string {
  const forwarded = req.headers.get("x-forwarded-for");
  if (forwarded) {
    const first = forwarded.split(",")[0]?.trim();
    if (first) return first;
  }
  return req.headers.get("x-real-ip") ?? "unknown";
}
