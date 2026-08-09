import { NextResponse, type NextRequest } from "next/server";
import { getSessionFromRequest } from "@/lib/auth/request";

const PROTECTED_PREFIXES = [
  "/dashboard", "/inbox", "/contacts", "/pipelines", "/broadcasts",
  "/automations", "/settings", "/flows", "/agents", "/notifications",
];

const AUTH_PAGES = ["/login", "/signup", "/forgot-password"];

export async function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;
  const session = await getSessionFromRequest(req);

  const isAuthPage = AUTH_PAGES.some((p) => pathname === p || pathname.startsWith(p + "/"));
  const isProtected = PROTECTED_PREFIXES.some((p) => pathname.startsWith(p));
  const isWhatsappApi = pathname.startsWith("/api/whatsapp/") && !pathname.includes("/webhook");

  if (session && isAuthPage) {
    const inviteToken = req.nextUrl.searchParams.get("invite");
    if (inviteToken) {
      return NextResponse.redirect(new URL(`/join/${inviteToken}`, req.url));
    }
    return NextResponse.redirect(new URL("/dashboard", req.url));
  }

  if (!session && isProtected) {
    return NextResponse.redirect(new URL("/login", req.url));
  }

  if (!session && isWhatsappApi) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  return NextResponse.next();
}

export const config = {
  matcher: [
    '/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)',
  ],
};
