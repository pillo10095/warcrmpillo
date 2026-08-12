import { NextResponse, type NextRequest } from "next/server";

const PROTECTED_PREFIXES = [
  "/dashboard", "/inbox", "/contacts", "/pipelines", "/broadcasts",
  "/automations", "/settings", "/flows", "/agents", "/notifications",
];

const AUTH_PAGES = ["/login", "/signup", "/forgot-password"];

const SESSION_COOKIE = "wacrm_session";

export function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;
  const hasSession = req.cookies.get(SESSION_COOKIE)?.value;

  const isAuthPage = AUTH_PAGES.some((p) => pathname === p || pathname.startsWith(p + "/"));
  const isProtected = PROTECTED_PREFIXES.some((p) => pathname.startsWith(p));

  if (hasSession && isAuthPage) {
    const inviteToken = req.nextUrl.searchParams.get("invite");
    if (inviteToken) {
      return NextResponse.redirect(new URL(`/join/${inviteToken}`, req.url));
    }
    return NextResponse.redirect(new URL("/dashboard", req.url));
  }

  if (!hasSession && isProtected) {
    return NextResponse.redirect(new URL("/login", req.url));
  }

  return NextResponse.next();
}

export const config = {
  matcher: [
    '/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)',
  ],
};
