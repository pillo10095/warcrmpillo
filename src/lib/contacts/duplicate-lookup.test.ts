import { beforeEach, describe, expect, it, vi } from "vitest";

const mockDb = vi.hoisted(() => ({
  contact: { findMany: vi.fn() },
}));

vi.mock("@/lib/db/prisma", () => ({ prisma: mockDb }));

import { findExistingContact } from "./duplicate-lookup";

beforeEach(() => {
  mockDb.contact.findMany.mockReset();
});

describe("findExistingContact", () => {
  it("pre-filters by the account and phone suffix, then matches via phonesMatch", async () => {
    mockDb.contact.findMany.mockResolvedValue([
      { id: "c1", phone: "37063949836", name: null },
    ]);
    const hit = await findExistingContact(undefined, "acct", "+370 063 949 836");
    expect(hit?.id).toBe("c1");
    expect(mockDb.contact.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { accountId: "acct", phone: { endsWith: "63949836" } },
      }),
    );
  });

  it("returns null when no candidate matches", async () => {
    mockDb.contact.findMany.mockResolvedValue([
      { id: "c1", phone: "15559999999", name: null },
    ]);
    const hit = await findExistingContact(undefined, "acct", "+1 555-123-4567");
    expect(hit).toBeNull();
  });

  it("returns null for an empty phone without querying", async () => {
    expect(await findExistingContact(undefined, "acct", "   ")).toBeNull();
    expect(mockDb.contact.findMany).not.toHaveBeenCalled();
  });
});