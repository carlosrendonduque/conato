/**
 * Sign/verify de la cookie de sesión usando Web Crypto, compatible con el
 * runtime Edge donde corre el middleware. La cookie codifica solo el
 * timestamp de emisión firmado con HMAC-SHA256(CONATO_COOKIE_SECRET).
 *
 * Formato: `<b64url(payload-json)>.<b64url(hmac-sha256-de-payload)>`
 */

const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000;

interface SessionPayload {
  issued: number;
}

async function getKey(): Promise<CryptoKey> {
  const secret = process.env.CONATO_COOKIE_SECRET;
  if (!secret || secret.length < 16) {
    throw new Error("CONATO_COOKIE_SECRET missing or too short");
  }
  return crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign", "verify"],
  );
}

export async function signSession(): Promise<string> {
  const payload: SessionPayload = { issued: Date.now() };
  const payloadStr = JSON.stringify(payload);
  const key = await getKey();
  const sig = await crypto.subtle.sign(
    "HMAC",
    key,
    new TextEncoder().encode(payloadStr),
  );
  return `${bytesToB64Url(new TextEncoder().encode(payloadStr))}.${bytesToB64Url(new Uint8Array(sig))}`;
}

export async function verifySession(cookie: string): Promise<boolean> {
  const parts = cookie.split(".");
  if (parts.length !== 2) return false;
  const [payloadB64, sigB64] = parts;
  if (!payloadB64 || !sigB64) return false;

  let payloadBytes: Uint8Array<ArrayBuffer>;
  let sigBytes: Uint8Array<ArrayBuffer>;
  try {
    payloadBytes = b64UrlToBytes(payloadB64);
    sigBytes = b64UrlToBytes(sigB64);
  } catch {
    return false;
  }

  const key = await getKey();
  const valid = await crypto.subtle.verify(
    "HMAC",
    key,
    sigBytes,
    payloadBytes,
  );
  if (!valid) return false;

  let payload: SessionPayload;
  try {
    const parsed = JSON.parse(new TextDecoder().decode(payloadBytes)) as unknown;
    if (
      typeof parsed !== "object" ||
      parsed === null ||
      typeof (parsed as { issued?: unknown }).issued !== "number"
    ) {
      return false;
    }
    payload = parsed as SessionPayload;
  } catch {
    return false;
  }

  if (Date.now() - payload.issued > SESSION_TTL_MS) return false;
  return true;
}

export function constantTimeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) {
    diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return diff === 0;
}

function bytesToB64Url(bytes: Uint8Array): string {
  let str = "";
  for (let i = 0; i < bytes.length; i++) {
    str += String.fromCharCode(bytes[i] as number);
  }
  return btoa(str).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function b64UrlToBytes(input: string): Uint8Array<ArrayBuffer> {
  const padded =
    input.replace(/-/g, "+").replace(/_/g, "/") +
    "=".repeat((4 - (input.length % 4)) % 4);
  const str = atob(padded);
  const buf = new ArrayBuffer(str.length);
  const bytes = new Uint8Array(buf);
  for (let i = 0; i < str.length; i++) bytes[i] = str.charCodeAt(i);
  return bytes;
}

export const SESSION_COOKIE = "conato_session";
export const SESSION_TTL_SECONDS = SESSION_TTL_MS / 1000;
