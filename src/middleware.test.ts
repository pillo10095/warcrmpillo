import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import type { SessionUser } from "@/lib/auth/request";

let mockSession: SessionUser | null = null;

vi.mock("@/lib/auth/request", () => ({
  getSessionFromRequest: vi.fn(async () => mockSession),
}));

const { middleware } = await import("./middleware");

beforeEach(() => {
  mockSession = null;
});

const SESSION: SessionUser = { userId: "user-1", accountId: "acct-1", role: "owner" };

describe("middleware — MySQL-backed session auth", () => {
  it("allows an authenticated user on a protected page", async () => {
    mockSession = SESSION;

    const res = await middleware(new NextRequest("https://app.test/dashboard"));

    expect(res.headers.get("location")).toBeNull();
  });

  it("redirects an unauthenticated user on a protected page to /login", async () => {
    const res = await middleware(new NextRequest("https://app.test/dashboard"));

    expect(res.status).toBe(307);
    expect(res.headers.get("location")).toContain("/login");
  });

  it("redirects an authenticated user on an auth page to /dashboard", async () => {
    mockSession = SESSION;

    const res = await middleware(new NextRequest("https://app.test/login"));

    expect(res.status).toBe(307);
    expect(res.headers.get("location")).toContain("/dashboard");
  });

  it("redirects an authenticated user with an invite token to /join/<token>", async () => {
    mockSession = SESSION;

    const res = await middleware(
      new NextRequest("https://app.test/login?invite=abc123"),
    );

    expect(res.headers.get("location")).toContain("/join/abc123");
  });

  it("returns 401 JSON for an unauthenticated whatsapp api request", async () => {
    const res = await middleware(
      new NextRequest("https://app.test/api/whatsapp/messages"),
    );

    expect(res.status).toBe(401);
    await expect(res.json()).resolves.toEqual({ error: "Unauthorized" });
  });

  it("does not block whatsapp webhooks when unauthenticated", async () => {
    const res = await middleware(
      new NextRequest("https://app.test/api/whatsapp/webhook"),
    );

    expect(res.status).not.toBe(401);
    expect(res.headers.get("location")).toBeNull();
  });

  it("does not redirect /api/auth routes when unauthenticated", async () => {
    const res = await middleware(
      new NextRequest("https://app.test/api/auth/login"),
    );

    expect(res.status).not.toBe(307);
    expect(res.headers.get("location")).toBeNull();
  });
});
