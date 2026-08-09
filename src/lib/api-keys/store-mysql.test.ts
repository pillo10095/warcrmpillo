import { describe, it, expect, vi } from "vitest";
import { findActiveKeyByHash } from "./store-mysql";

const mockDb = vi.hoisted(() => ({
  apiKey: { findUnique: vi.fn(), update: vi.fn().mockResolvedValue({}) },
  account: { findUnique: vi.fn().mockResolvedValue({ name: "Acme" }) },
}));

vi.mock("@/lib/db/prisma", () => ({ prisma: mockDb }));

describe("findActiveKeyByHash", () => {
  it("returns null for unknown hash", async () => {
    mockDb.apiKey.findUnique.mockResolvedValue(null);
    expect(await findActiveKeyByHash("nope")).toBeNull();
  });

  it("returns null for revoked keys", async () => {
    mockDb.apiKey.findUnique.mockResolvedValue({
      id: "k1", accountId: "a1", createdBy: null, name: "k", scopes: "[]",
      revokedAt: new Date(), expiresAt: null, lastUsedAt: null,
    });
    expect(await findActiveKeyByHash("rev")).toBeNull();
  });

  it("returns null for expired keys", async () => {
    mockDb.apiKey.findUnique.mockResolvedValue({
      id: "k1", accountId: "a1", createdBy: null, name: "k", scopes: "[]",
      revokedAt: null, expiresAt: new Date(Date.now() - 1000), lastUsedAt: null,
    });
    expect(await findActiveKeyByHash("exp")).toBeNull();
  });

  it("returns active key with parsed scopes", async () => {
    mockDb.apiKey.findUnique.mockResolvedValue({
      id: "k1", accountId: "a1", createdBy: "u1", name: "k", scopes: '["messages:send"]',
      revokedAt: null, expiresAt: null, lastUsedAt: null,
    });
    const key = await findActiveKeyByHash("ok");
    expect(key?.id).toBe("k1");
    expect(key?.accountId).toBe("a1");
    expect(key?.scopes).toEqual(["messages:send"]);
  });
});
