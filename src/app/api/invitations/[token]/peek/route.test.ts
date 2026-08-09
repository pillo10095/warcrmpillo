import { describe, it, expect, vi, beforeEach } from "vitest";
import { __resetRateLimitForTests } from "@/lib/rate-limit";

const { mockDb } = vi.hoisted(() => ({
  mockDb: {
    invitation: { findUnique: vi.fn() },
  },
}));

vi.mock("@/lib/db/prisma", () => ({ prisma: mockDb }));

import { GET } from "./route";

describe("GET /api/invitations/[token]/peek", () => {
  beforeEach(() => __resetRateLimitForTests());

  it("returns not_found for an unknown token", async () => {
    mockDb.invitation.findUnique.mockResolvedValue(null);
    const res = await GET(
      new Request("http://localhost/api/invitations/xyz/peek"),
      { params: Promise.resolve({ token: "xyz" }) },
    );
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: false, reason: "not_found" });
  });

  it("returns used for an accepted invitation", async () => {
    mockDb.invitation.findUnique.mockResolvedValue({
      role: "agent",
      expiresAt: new Date(Date.now() + 1000 * 60 * 60 * 24),
      acceptedAt: new Date(),
      account: { name: "Acme" },
    });
    const res = await GET(
      new Request("http://localhost/api/invitations/xyz/peek"),
      { params: Promise.resolve({ token: "xyz" }) },
    );
    expect(await res.json()).toEqual({ ok: false, reason: "used" });
  });

  it("returns expired for an expired invitation", async () => {
    mockDb.invitation.findUnique.mockResolvedValue({
      role: "agent",
      expiresAt: new Date(Date.now() - 1000 * 60),
      acceptedAt: null,
      account: { name: "Acme" },
    });
    const res = await GET(
      new Request("http://localhost/api/invitations/xyz/peek"),
      { params: Promise.resolve({ token: "xyz" }) },
    );
    expect(await res.json()).toEqual({ ok: false, reason: "expired" });
  });

  it("returns account_name, role, expires_at for a valid invitation", async () => {
    const expiresAt = new Date(Date.now() + 1000 * 60 * 60 * 24);
    mockDb.invitation.findUnique.mockResolvedValue({
      role: "admin",
      expiresAt,
      acceptedAt: null,
      account: { name: "Acme" },
    });
    const res = await GET(
      new Request("http://localhost/api/invitations/xyz/peek"),
      { params: Promise.resolve({ token: "xyz" }) },
    );
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      ok: true,
      account_name: "Acme",
      role: "admin",
      expires_at: expiresAt.toISOString(),
    });
  });

  it("looks up by the SHA-256 token hash", async () => {
    mockDb.invitation.findUnique.mockResolvedValue(null);
    await GET(new Request("http://localhost/api/invitations/abc/peek"), {
      params: Promise.resolve({ token: "abc" }),
    });
    expect(mockDb.invitation.findUnique).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { tokenHash: expect.any(String) },
      }),
    );
    const where = mockDb.invitation.findUnique.mock.calls[0][0].where;
    expect(where.tokenHash).not.toBe("abc");
    expect(where.tokenHash).toMatch(/^[0-9a-f]{64}$/);
  });
});
