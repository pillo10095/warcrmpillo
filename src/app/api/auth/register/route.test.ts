import { describe, it, expect, vi, beforeEach } from "vitest";

const { mockDb } = vi.hoisted(() => ({
  mockDb: {
    user: {
      findUnique: vi.fn().mockResolvedValue(null),
      create: vi.fn().mockResolvedValue({ id: "user-1", email: "a@b.com" }),
    },
    account: { create: vi.fn().mockResolvedValue({ id: "acc-1" }) },
    accountMember: { create: vi.fn().mockResolvedValue({}) },
    session: { create: vi.fn().mockResolvedValue({ id: "s1" }) },
    $transaction: vi.fn().mockImplementation(async (fn) => fn(mockDb)),
  },
}));

import { POST } from "./route";

vi.mock("@/lib/db/prisma", () => ({ prisma: mockDb }));
vi.mock("@/lib/auth/password", () => ({
  hashPassword: vi.fn().mockResolvedValue("hashed"),
}));
vi.mock("@/lib/auth/session", () => ({
  createSession: vi.fn().mockResolvedValue({ token: "t", expiresAt: new Date(Date.now() + 1000) }),
}));

describe("POST /api/auth/register", () => {
  beforeEach(() => vi.clearAllMocks());

  it("creates user, account, owner membership, and session", async () => {
    const res = await POST(
      new Request("http://localhost/api/auth/register", {
        method: "POST",
        body: JSON.stringify({ email: "a@b.com", password: "password123", fullName: "Ana" }),
      }),
    );
    expect(res.status).toBe(200);
    expect(mockDb.user.create).toHaveBeenCalled();
    expect(mockDb.account.create).toHaveBeenCalled();
    expect(mockDb.accountMember.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ role: "owner" }) }),
    );
  });

  it("rejects duplicate email", async () => {
    mockDb.user.findUnique.mockResolvedValue({ id: "u" });
    const res = await POST(
      new Request("http://localhost/api/auth/register", {
        method: "POST",
        body: JSON.stringify({ email: "dup@b.com", password: "password123", fullName: "D" }),
      }),
    );
    expect(res.status).toBe(409);
  });

  it("rejects short passwords", async () => {
    const res = await POST(
      new Request("http://localhost/api/auth/register", {
        method: "POST",
        body: JSON.stringify({ email: "a@b.com", password: "123", fullName: "A" }),
      }),
    );
    expect(res.status).toBe(400);
  });
});
