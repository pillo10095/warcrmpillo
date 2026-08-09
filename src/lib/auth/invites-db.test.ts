import { describe, it, expect, vi } from "vitest";
import { createInvitation, redeemInvitation } from "./invites-db";

const mockDb = vi.hoisted(() => ({
  invitation: {
    create: vi.fn().mockResolvedValue({ id: "inv-1" }),
    findUnique: vi.fn().mockResolvedValue(null),
    update: vi.fn().mockResolvedValue({}),
  },
  accountMember: { upsert: vi.fn().mockResolvedValue({}) },
  account: { findUnique: vi.fn().mockResolvedValue({ id: "acc-1" }) },
  $transaction: vi.fn().mockImplementation(async (fn: any) => fn(mockDb)),
}));

vi.mock("@/lib/db/prisma", () => ({ prisma: mockDb }));

describe("invites-db", () => {
  it("creates an invitation storing only the token hash", async () => {
    const { token, expiresAt } = await createInvitation("acc-1", "u-1", "agent");
    expect(token.length).toBeGreaterThan(20);
    expect(expiresAt.getTime()).toBeGreaterThan(Date.now());
    const data = mockDb.invitation.create.mock.calls[0][0].data;
    expect(data.tokenHash).not.toBe(token);
  });

  it("redeems an invitation and joins the account", async () => {
    mockDb.invitation.findUnique.mockResolvedValue({
      id: "inv-1",
      accountId: "acc-1",
      role: "agent",
      expiresAt: new Date(Date.now() + 1000 * 60 * 60 * 24),
      acceptedAt: null,
    });
    mockDb.account.findUnique.mockResolvedValue({ id: "acc-1" });
    const accountId = await redeemInvitation("the-token", "user-2");
    expect(accountId).toBe("acc-1");
    expect(mockDb.accountMember.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { userId: "user-2" },
        create: expect.objectContaining({ accountId: "acc-1", role: "agent" }),
      }),
    );
    expect(mockDb.invitation.update).toHaveBeenCalled();
  });

  it("rejects an already-accepted invitation", async () => {
    mockDb.invitation.findUnique.mockResolvedValue({
      id: "inv-1",
      accountId: "acc-1",
      role: "agent",
      expiresAt: new Date(Date.now() + 1000 * 60 * 60 * 24),
      acceptedAt: new Date(),
    });
    await expect(redeemInvitation("used-token", "user-3")).rejects.toThrow(/used/i);
  });
});
