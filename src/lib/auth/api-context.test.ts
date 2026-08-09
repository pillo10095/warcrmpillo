import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { generateApiKey } from "@/lib/api-keys/keys";
import { ApiError } from "@/lib/api/v1/respond";
import { __resetRateLimitForTests, RATE_LIMITS } from "@/lib/rate-limit";

// Mock the Prisma client — `requireApiKey` resolves the key through
// the MySQL store, which queries `prisma.apiKey`. Tests drive which
// row a lookup returns via mockDb.
const mockDb = vi.hoisted(() => ({
  apiKey: { findUnique: vi.fn(), update: vi.fn().mockResolvedValue({}) },
}));

vi.mock("@/lib/db/prisma", () => ({ prisma: mockDb }));

// Import AFTER the mocks are registered.
const { requireApiKey } = await import("./api-context");

const KEY = generateApiKey().plaintext;

function reqWith(authHeader?: string): Request {
  return new Request("https://crm.example.com/api/v1/me", {
    headers: authHeader ? { authorization: authHeader } : {},
  });
}

function row(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: "key-1",
    accountId: "acct-1",
    createdBy: "user-1",
    name: "Test key",
    keyPrefix: "wacrm_live_",
    keyHash: "hash",
    scopes: '["messages:send"]',
    lastUsedAt: null,
    expiresAt: null,
    revokedAt: null,
    createdAt: new Date("2026-01-01T00:00:00Z"),
    ...overrides,
  };
}

beforeEach(() => {
  __resetRateLimitForTests();
  mockDb.apiKey.findUnique.mockReset();
  mockDb.apiKey.update.mockReset().mockResolvedValue({});
});

afterEach(() => {
  __resetRateLimitForTests();
});

async function expectApiError(p: Promise<unknown>, code: string, status: number) {
  await expect(p).rejects.toBeInstanceOf(ApiError);
  await p.catch((e: unknown) => {
    const err = e as ApiError;
    expect(err.code).toBe(code);
    expect(err.status).toBe(status);
  });
}

describe("requireApiKey", () => {
  it("401s when no Authorization header is present", async () => {
    await expectApiError(requireApiKey(reqWith()), "unauthorized", 401);
    expect(mockDb.apiKey.findUnique).not.toHaveBeenCalled();
  });

  it("401s on a token that doesn't look like a wacrm key", async () => {
    await expectApiError(
      requireApiKey(reqWith("Bearer some-invite-token")),
      "unauthorized",
      401,
    );
    expect(mockDb.apiKey.findUnique).not.toHaveBeenCalled();
  });

  it("401s when the key is unknown (store returns null)", async () => {
    mockDb.apiKey.findUnique.mockResolvedValue(null);
    await expectApiError(
      requireApiKey(reqWith(`Bearer ${KEY}`)),
      "unauthorized",
      401,
    );
  });

  it("401s when the key is revoked", async () => {
    mockDb.apiKey.findUnique.mockResolvedValue(row({ revokedAt: new Date() }));
    await expectApiError(
      requireApiKey(reqWith(`Bearer ${KEY}`)),
      "unauthorized",
      401,
    );
  });

  it("401s when the key is expired", async () => {
    mockDb.apiKey.findUnique.mockResolvedValue(
      row({ expiresAt: new Date(Date.now() - 1000) }),
    );
    await expectApiError(
      requireApiKey(reqWith(`Bearer ${KEY}`)),
      "unauthorized",
      401,
    );
  });

  it("returns a context for a valid key with no scope required", async () => {
    mockDb.apiKey.findUnique.mockResolvedValue(row());
    const ctx = await requireApiKey(reqWith(`Bearer ${KEY}`));
    expect(ctx.authType).toBe("api_key");
    expect(ctx.accountId).toBe("acct-1");
    expect(ctx.keyId).toBe("key-1");
    expect(ctx.scopes).toEqual(["messages:send"]);
    expect(ctx.supabase).toBeNull();
    expect(mockDb.apiKey.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "key-1" },
        data: expect.objectContaining({ lastUsedAt: expect.any(Date) }),
      }),
    );
  });

  it("accepts a bare key without the 'Bearer ' prefix", async () => {
    mockDb.apiKey.findUnique.mockResolvedValue(row());
    const ctx = await requireApiKey(reqWith(KEY));
    expect(ctx.accountId).toBe("acct-1");
  });

  it("403s when the key lacks the required scope", async () => {
    mockDb.apiKey.findUnique.mockResolvedValue(row({ scopes: '["contacts:read"]' }));
    await expectApiError(
      requireApiKey(reqWith(`Bearer ${KEY}`), "messages:send"),
      "forbidden",
      403,
    );
  });

  it("passes when the key has the required scope", async () => {
    mockDb.apiKey.findUnique.mockResolvedValue(row());
    const ctx = await requireApiKey(reqWith(`Bearer ${KEY}`), "messages:send");
    expect(ctx.accountId).toBe("acct-1");
  });

  it("429s once the per-key budget is exhausted", async () => {
    mockDb.apiKey.findUnique.mockResolvedValue(row());
    // Burn the whole window.
    for (let i = 0; i < RATE_LIMITS.publicApi.limit; i++) {
      await requireApiKey(reqWith(`Bearer ${KEY}`));
    }
    await expectApiError(
      requireApiKey(reqWith(`Bearer ${KEY}`)),
      "rate_limited",
      429,
    );
  });
});
