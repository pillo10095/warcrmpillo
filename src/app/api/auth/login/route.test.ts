import { describe, it, expect, vi, beforeEach } from "vitest";

const { mockDb } = vi.hoisted(() => ({
  mockDb: {
    user: {
      findUnique: vi.fn().mockResolvedValue({
        id: "user-1",
        email: "a@b.com",
        passwordHash: "hash",
      }),
    },
    session: { create: vi.fn().mockResolvedValue({ id: "s1" }) },
  },
}));

vi.mock("@/lib/db/prisma", () => ({ prisma: mockDb }));
vi.mock("@/lib/auth/password", () => ({
  verifyPassword: vi.fn().mockResolvedValue(true),
}));
vi.mock("@/lib/auth/session", () => ({
  createSession: vi.fn().mockResolvedValue({ token: "tok", expiresAt: new Date(Date.now() + 1000) }),
}));

import { POST } from "./route";

describe("POST /api/auth/login", () => {
  beforeEach(() => vi.clearAllMocks());

  it("sets session cookie on valid credentials", async () => {
    const res = await POST(
      new Request("http://localhost/api/auth/login", {
        method: "POST",
        body: JSON.stringify({ email: "a@b.com", password: "password123" }),
      }),
    );
    expect(res.status).toBe(200);
    const setCookie = res.headers.get("set-cookie") ?? "";
    expect(setCookie).toContain("wacrm_session=");
    expect(setCookie).toContain("HttpOnly");
  });

  it("rejects wrong password with 401", async () => {
    const { verifyPassword } = await import("@/lib/auth/password");
    vi.mocked(verifyPassword).mockResolvedValue(false);
    const res = await POST(
      new Request("http://localhost/api/auth/login", {
        method: "POST",
        body: JSON.stringify({ email: "a@b.com", password: "nope" }),
      }),
    );
    expect(res.status).toBe(401);
  });

  it("rejects unknown email with 401 (same message)", async () => {
    mockDb.user.findUnique.mockResolvedValue(null);
    const res = await POST(
      new Request("http://localhost/api/auth/login", {
        method: "POST",
        body: JSON.stringify({ email: "x@b.com", password: "whatever1" }),
      }),
    );
    expect(res.status).toBe(401);
  });
});
