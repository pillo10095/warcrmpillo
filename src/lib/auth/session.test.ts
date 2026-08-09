import { describe, it, expect, vi, beforeEach } from "vitest";
import { createSession, getSessionUser, deleteSession, hashToken } from "./session";

const mockDb = vi.hoisted(() => ({
  session: {
    create: vi.fn().mockResolvedValue({ id: "s1" }),
    findUnique: vi.fn(),
    delete: vi.fn().mockResolvedValue(undefined),
    deleteMany: vi.fn(),
    update: vi.fn(),
  },
  accountMember: {
    findUnique: vi.fn().mockResolvedValue({ accountId: "acc-1", role: "owner" }),
  },
}));

vi.mock("@/lib/db/prisma", () => ({ prisma: mockDb }));

describe("session", () => {
  beforeEach(() => vi.clearAllMocks());

  it("stores only a SHA-256 hash of the token", async () => {
    const { token, expiresAt } = await createSession("user-1");
    expect(token).toHaveLength(96); // 48 bytes hex
    expect(expiresAt.getTime()).toBeGreaterThan(Date.now());
    const saved = mockDb.session.create.mock.calls[0][0];
    expect(saved.data.tokenHash).toBe(hashToken(token));
    expect(saved.data.tokenHash).not.toBe(token);
  });

  it("returns null for unknown token", async () => {
    mockDb.session.findUnique.mockResolvedValue(null);
    expect(await getSessionUser("nope")).toBeNull();
  });

  it("returns user + account for valid session and renews", async () => {
    const future = new Date(Date.now() + 1000 * 60 * 60 * 24 * 29);
    mockDb.session.findUnique.mockResolvedValue({
      userId: "user-1",
      expiresAt: future,
      lastSeenAt: new Date(Date.now() - 1000 * 60 * 60 * 24 * 9), // 9 days ago → beyond 7-day renew window
    });
    const result = await getSessionUser("tok");
    expect(result).toEqual({ userId: "user-1", accountId: "acc-1", role: "owner" });
    expect(mockDb.session.update).toHaveBeenCalled();
  });

  it("rejects expired sessions", async () => {
    mockDb.session.findUnique.mockResolvedValue({
      userId: "user-1",
      expiresAt: new Date(Date.now() - 1000),
      lastSeenAt: new Date(),
    });
    expect(await getSessionUser("expired")).toBeNull();
  });

  it("deletes a session", async () => {
    await deleteSession("tok");
    expect(mockDb.session.delete).toHaveBeenCalledWith({ where: { tokenHash: hashToken("tok") } });
  });
});
