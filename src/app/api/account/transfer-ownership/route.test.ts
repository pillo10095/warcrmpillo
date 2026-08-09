import { describe, it, expect, vi, beforeEach } from "vitest";
import { __resetRateLimitForTests } from "@/lib/rate-limit";

const { mockDb } = vi.hoisted(() => ({
  mockDb: {
    accountMember: {
      findUnique: vi.fn(),
      update: vi.fn().mockResolvedValue({}),
    },
    account: { update: vi.fn().mockResolvedValue({}) },
    $transaction: vi.fn().mockImplementation(async (fn: any) => fn(mockDb)),
  },
}));

vi.mock("@/lib/db/prisma", () => ({ prisma: mockDb }));
vi.mock("@/lib/auth/request", () => ({
  getSessionFromRequest: vi.fn(),
}));

import { getSessionFromRequest } from "@/lib/auth/request";

import { POST } from "./route";

const ownerUser = {
  userId: "owner-1",
  accountId: "acc-1",
  role: "owner",
};
const newOwnerId = "11111111-2222-3333-4444-555555555555";

describe("POST /api/account/transfer-ownership", () => {
  beforeEach(() => {
    __resetRateLimitForTests();
    vi.mocked(getSessionFromRequest).mockResolvedValue(ownerUser);
  });

  it("returns 401 when not authenticated", async () => {
    vi.mocked(getSessionFromRequest).mockResolvedValue(null);
    const res = await POST(
      new Request("http://localhost/api/account/transfer-ownership", {
        method: "POST",
        body: JSON.stringify({ newOwnerUserId: newOwnerId }),
      }),
    );
    expect(res.status).toBe(401);
  });

  it("returns 403 when the caller is not the owner", async () => {
    vi.mocked(getSessionFromRequest).mockResolvedValue({
      userId: "admin-1",
      accountId: "acc-1",
      role: "admin",
    });
    const res = await POST(
      new Request("http://localhost/api/account/transfer-ownership", {
        method: "POST",
        body: JSON.stringify({ newOwnerUserId: newOwnerId }),
      }),
    );
    expect(res.status).toBe(403);
  });

  it("returns 400 for a malformed newOwnerUserId", async () => {
    const res = await POST(
      new Request("http://localhost/api/account/transfer-ownership", {
        method: "POST",
        body: JSON.stringify({ newOwnerUserId: "not-a-uuid" }),
      }),
    );
    expect(res.status).toBe(400);
  });

  it("returns 400 when transferring to yourself", async () => {
    const res = await POST(
      new Request("http://localhost/api/account/transfer-ownership", {
        method: "POST",
        body: JSON.stringify({ newOwnerUserId: "owner-1" }),
      }),
    );
    expect(res.status).toBe(400);
  });

  it("returns 400 when the target is not a member of the account", async () => {
    mockDb.accountMember.findUnique.mockResolvedValue(null);
    const res = await POST(
      new Request("http://localhost/api/account/transfer-ownership", {
        method: "POST",
        body: JSON.stringify({ newOwnerUserId: newOwnerId }),
      }),
    );
    expect(res.status).toBe(400);
  });

  it("demotes old owner, promotes target, and updates the account owner", async () => {
    mockDb.accountMember.findUnique.mockResolvedValue({
      userId: newOwnerId,
      accountId: "acc-1",
      role: "admin",
    });
    const res = await POST(
      new Request("http://localhost/api/account/transfer-ownership", {
        method: "POST",
        body: JSON.stringify({ newOwnerUserId: newOwnerId }),
      }),
    );
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
    expect(mockDb.account.update).toHaveBeenCalledWith({
      where: { id: "acc-1" },
      data: { ownerUserId: newOwnerId },
    });
    expect(mockDb.accountMember.update).toHaveBeenCalledWith({
      where: { userId: "owner-1" },
      data: { role: "admin" },
    });
    expect(mockDb.accountMember.update).toHaveBeenCalledWith({
      where: { userId: newOwnerId },
      data: { role: "owner" },
    });
  });
});
