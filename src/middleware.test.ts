import { describe, expect, it, beforeEach } from "vitest";
import { NextRequest } from "next/server";

const { middleware } = await import("./middleware");

const SESSION_COOKIE = "wacrm_session";

function reqWithCookie(url: string, cookieValue?: string): NextRequest {
  const r = new NextRequest(url);
  if (cookieValue) {
    r.cookies.set(SESSION_COOKIE, cookieValue);
  }
  return r;
}

describe("middleware — optimistic cookie check (edge-safe)", () => {
  it("allows an authenticated user on a protected page", async () => {
    const res = await middleware(reqWithCookie("https://app.test/dashboard", "tok123"));

    expect(res.headers.get("location")).toBeNull();
  });

  it("redirects an unauthenticated user on a protected page to /login", async () => {
    const res = await middleware(reqWithCookie("https://app.test/dashboard"));

    expect(res.status).toBe(307);
    expect(res.headers.get("location")).toContain("/login");
  });

  it("redirects an authenticated user on an auth page to /dashboard", async () => {
    const res = await middleware(reqWithCookie("https://app.test/login", "tok123"));

    expect(res.status).toBe(307);
    expect(res.headers.get("location")).toContain("/dashboard");
  });

  it("redirects an authenticated user with an invite token to /join/<token>", async () => {
    const res = await middleware(reqWithCookie("https://app.test/login?invite=abc123", "tok123"));

    expect(res.headers.get("location")).toContain("/join/abc123");
  });

  it("does not block whatsapp webhooks when unauthenticated", async () => {
    const res = await middleware(reqWithCookie("https://app.test/api/whatsapp/webhook"));

    expect(res.status).not.toBe(401);
    expect(res.headers.get("location")).toBeNull();
  });

  it("does not redirect /api/auth routes when unauthenticated", async () => {
    const res = await middleware(reqWithCookie("https://app.test/api/auth/login"));

    expect(res.status).not.toBe(307);
    expect(res.headers.get("location")).toBeNull();
  });

  it("allows unauthenticated users on public pages", async () => {
    const res = await middleware(reqWithCookie("https://app.test/"));

    expect(res.headers.get("location")).toBeNull();
  });
});
