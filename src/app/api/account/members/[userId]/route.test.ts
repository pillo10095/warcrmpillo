import { describe, it, expect, vi, beforeEach } from "vitest";
import { __resetRateLimitForTests } from "@/lib/rate-limit";

const { mockDb } = vi.hoisted(() => ({
  mockDb: {
    accountMember: {
      findUnique: vi.fn(),
      update: vi.fn().mockResolvedValue({}),
    },
    account: { create: vi.fn().mockResolvedValue({ id: "new-acc-1" }) },
    $transaction: vi.fn().mockImplementation(async (fn: any) => fn(mockDb)),
  },
}));

vi.mock("@/lib/db/prisma", () => ({ prisma: mockDb }));
vi.mock("@/lib/auth/request", () => ({
  getSessionFromRequest: vi.fn(),
}));

import { getSessionFromRequest } from "@/lib/auth/request";

import { PATCH, DELETE } from "./route";

const adminUser = {
  userId: "admin-1",
  accountId: "acc-1",
  role: "admin",
};

describe("PATCH /api/account/members/[userId]", () => {
  beforeEach(() => {
    __resetRateLimitForTests();
    vi.mocked(getSessionFromRequest).mockResolvedValue(adminUser);
  });

  it("returns 401 when not authenticated", async () => {
    vi.mocked(getSessionFromRequest).mockResolvedValue(null);
    const res = await PATCH(
      new Request("http://localhost/api/account/members/m-1", {
        method: "PATCH",
        body: JSON.stringify({ role: "agent" }),
      }),
      { params: Promise.resolve({ userId: "m-1" }) },
    );
    expect(res.status).toBe(401);
  });

  it("returns 403 when the caller is not admin+", async () => {
    vi.mocked(getSessionFromRequest).mockResolvedValue({
      userId: "agent-1",
      accountId: "acc-1",
      role: "agent",
    });
    const res = await PATCH(
      new Request("http://localhost/api/account/members/m-1", {
        method: "PATCH",
        body: JSON.stringify({ role: "viewer" }),
      }),
      { params: Promise.resolve({ userId: "m-1" }) },
    );
    expect(res.status).toBe(403);
  });

  it("returns 400 for an invalid role", async () => {
    const res = await PATCH(
      new Request("http://localhost/api/account/members/m-1", {
        method: "PATCH",
        body: JSON.stringify({ role: "superuser" }),
      }),
      { params: Promise.resolve({ userId: "m-1" }) },
    );
    expect(res.status).toBe(400);
  });

  it("returns 400 when promoting to owner", async () => {
    const res = await PATCH(
      new Request("http://localhost/api/account/members/m-1", {
        method: "PATCH",
        body: JSON.stringify({ role: "owner" }),
      }),
      { params: Promise.resolve({ userId: "m-1" }) },
    );
    expect(res.status).toBe(400);
  });

  it("returns 400 when the target is not in the account", async () => {
    mockDb.accountMember.findUnique.mockResolvedValue({
      userId: "m-1",
      accountId: "other-acc",
      role: "agent",
    });
    const res = await PATCH(
      new Request("http://localhost/api/account/members/m-1", {
        method: "PATCH",
        body: JSON.stringify({ role: "admin" }),
      }),
      { params: Promise.resolve({ userId: "m-1" }) },
    );
    expect(res.status).toBe(403);
  });

  it("returns 400 when the target is the account owner", async () => {
    mockDb.accountMember.findUnique.mockResolvedValue({
      userId: "m-1",
      accountId: "acc-1",
      role: "owner",
    });
    const res = await PATCH(
      new Request("http://localhost/api/account/members/m-1", {
        method: "PATCH",
        body: JSON.stringify({ role: "agent" }),
      }),
      { params: Promise.resolve({ userId: "m-1" }) },
    );
    expect(res.status).toBe(400);
  });

  it("updates the member role and returns ok", async () => {
    mockDb.accountMember.findUnique.mockResolvedValue({
      userId: "m-1",
      accountId: "acc-1",
      role: "agent",
    });
    const res = await PATCH(
      new Request("http://localhost/api/account/members/m-1", {
        method: "PATCH",
        body: JSON.stringify({ role: "admin" }),
      }),
      { params: Promise.resolve({ userId: "m-1" }) },
    );
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
    expect(mockDb.accountMember.update).toHaveBeenCalledWith({
      where: { userId: "m-1" },
      data: { role: "admin" },
    });
  });
});

describe("DELETE /api/account/members/[userId]", () => {
  beforeEach(() => {
    __resetRateLimitForTests();
    vi.mocked(getSessionFromRequest).mockResolvedValue(adminUser);
  });

  it("moves the member to a fresh personal account and returns its id", async () => {
    mockDb.accountMember.findUnique.mockResolvedValue({
      userId: "m-1",
      accountId: "acc-1",
      role: "agent",
      user: { fullName: "Maya Member", email: "m@b.com" },
    });
    const res = await DELETE(
      new Request("http://localhost/api/account/members/m-1", {
        method: "DELETE",
      }),
      { params: Promise.resolve({ userId: "m-1" }) },
    );
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      ok: true,
      newPersonalAccountId: "new-acc-1",
    });
    expect(mockDb.account.create).toHaveBeenCalledWith({
      data: { name: "Maya Member", ownerUserId: "m-1" },
      select: { id: true },
    });
  });

  it("returns 400 when the target is the account owner", async () => {
    mockDb.accountMember.findUnique.mockResolvedValue({
      userId: "m-1",
      accountId: "acc-1",
      role: "owner",
      user: { fullName: "Owner", email: "o@b.com" },
    });
    const res = await DELETE(
      new Request("http://localhost/api/account/members/m-1", {
        method: "DELETE",
      }),
      { params: Promise.resolve({ userId: "m-1" }) },
    );
    expect(res.status).toBe(400);
  });
});
