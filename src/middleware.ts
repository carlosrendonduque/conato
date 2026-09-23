import { NextResponse, type NextRequest } from "next/server";
import { SESSION_COOKIE, verifySession } from "@/lib/auth-edge";

/**
 * Auth gate v1: cookie firmada con CONATO_COOKIE_SECRET. Si la cookie es
 * inválida o falta, las páginas redirigen a /login y las APIs devuelven
 * 401. /login, /api/auth/*, /api/health quedan abiertos por el matcher.
 */
export async function middleware(req: NextRequest) {
  const cookie = req.cookies.get(SESSION_COOKIE)?.value;
  const valid = cookie ? await verifySession(cookie).catch(() => false) : false;
  if (valid) return NextResponse.next();

  if (req.nextUrl.pathname.startsWith("/api/")) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const loginUrl = new URL("/login", req.url);
  const target = req.nextUrl.pathname + req.nextUrl.search;
  if (target !== "/") loginUrl.searchParams.set("next", target);
  return NextResponse.redirect(loginUrl);
}

export const config = {
  matcher: [
    // /editor está fuera del auth gate: usa su propio token (`CONATO_EDITOR_TOKEN`)
    // validado en cada ruta. Lectores externos no necesitan saber el secreto
    // del autor para leer lo que se les comparte.
    "/((?!login|api/auth|api/health|editor|_next/static|_next/image|favicon.ico).*)",
  ],
};
