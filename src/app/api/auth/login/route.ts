import { NextResponse } from "next/server";
import {
  SESSION_COOKIE,
  SESSION_TTL_SECONDS,
  constantTimeEqual,
  signSession,
} from "@/lib/auth-edge";
import { clientKey, rateLimit, resetRateLimit } from "@/lib/rate-limit";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(req: Request) {
  // El secreto compartido es la única credencial, así que limitamos el ritmo
  // de intentos antes de tocarlo. Ver src/lib/rate-limit.ts sobre su alcance.
  const key = clientKey(req);
  const limit = rateLimit(key);
  if (!limit.allowed) {
    return NextResponse.json(
      { error: "too_many_attempts" },
      { status: 429, headers: { "retry-after": String(limit.retryAfter) } },
    );
  }

  const formData = await req.formData();
  const secret = String(formData.get("secret") ?? "");
  const nextRaw = String(formData.get("next") ?? "/");

  const expected = process.env.CONATO_ACCESS_SECRET;
  if (!expected) {
    return NextResponse.json(
      { error: "server_misconfigured" },
      { status: 500 },
    );
  }

  // Solo aceptamos paths same-origin como destino, para evitar redirect-abuse.
  const safeNext =
    nextRaw.startsWith("/") && !nextRaw.startsWith("//") ? nextRaw : "/";

  if (!constantTimeEqual(secret, expected)) {
    const url = new URL("/login", req.url);
    url.searchParams.set("error", "1");
    if (safeNext !== "/") url.searchParams.set("next", safeNext);
    return NextResponse.redirect(url, { status: 303 });
  }

  resetRateLimit(key);

  const cookieValue = await signSession();
  const res = NextResponse.redirect(new URL(safeNext, req.url), {
    status: 303,
  });
  res.cookies.set(SESSION_COOKIE, cookieValue, {
    httpOnly: true,
    // En dev local el navegador no acepta `secure` sobre http; solo lo
    // forzamos en producción (Vercel siempre HTTPS).
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    maxAge: SESSION_TTL_SECONDS,
    path: "/",
  });
  return res;
}
