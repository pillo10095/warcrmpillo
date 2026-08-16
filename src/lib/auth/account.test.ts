import { afterEach, describe, expect, it, vi } from "vitest";

// getCurrentAccount resolves the caller's account context. After the
// Supabase → MySQL/Prisma migration, account membership lives in
// `account_members` (the old `profiles.account_id/account_role`
// columns no longer exist). The regression this file guards: context
// resolution must use Prisma point lookups (accountMember by userId,
// then account by id) and never touch the removed Supabase columns.

const createClient = vi.fn();
vi.mock("@/lib/supabase/server", () => ({
  createClient: () => createClient(),
}));

const mockDb = {
  accountMember: {
    findUnique: vi.fn(),
  },
  account: {
    findUnique: vi.fn(),
  },
};
vi.mock("@/lib/db/prisma", () => ({ prisma: mockDb }));

const { getCurrentAccount, UnauthorizedError, ForbiddenError } = await import(
  "./account"
);

afterEach(() => {
  vi.clearAllMocks();
});

function makeClient(user: { id: string } | null, userErr?: unknown) {
  return {
    client: {
      auth: {
        getUser: () =>
          Promise.resolve({
            data: { user },
            error: userErr ?? null,
          }),
      },
    },
  };
}

describe("getCurrentAccount", () => {
  it("resolves context via account_members + accounts (Prisma)", async () => {
    const { client } = makeClient({ id: "user-1" });
    createClient.mockReturnValue(client);
    mockDb.accountMember.findUnique.mockResolvedValue({
      userId: "user-1",
      accountId: "acct-1",
      role: "owner",
    });
    mockDb.account.findUnique.mockResolvedValue({ id: "acct-1", name: "Acme" });

    const ctx = await getCurrentAccount();

    expect(ctx).toMatchObject({
      userId: "user-1",
      accountId: "acct-1",
      role: "owner",
      account: { id: "acct-1", name: "Acme" },
    });
    expect(mockDb.accountMember.findUnique).toHaveBeenCalledWith({
      where: { userId: "user-1" },
    });
    expect(mockDb.account.findUnique).toHaveBeenCalledWith({
      where: { id: "acct-1" },
      select: { id: true, name: true },
    });
  });

  it("throws UnauthorizedError when there is no session", async () => {
    const { client } = makeClient(null);
    createClient.mockReturnValue(client);
    await expect(getCurrentAccount()).rejects.toBeInstanceOf(UnauthorizedError);
  });

  it("rejects a user with no account membership", async () => {
    const { client } = makeClient({ id: "user-1" });
    createClient.mockReturnValue(client);
    mockDb.accountMember.findUnique.mockResolvedValue(null);
    await expect(getCurrentAccount()).rejects.toThrow(
      "Profile is not linked to an account",
    );
  });

  it("rejects an unknown account role", async () => {
    const { client } = makeClient({ id: "user-1" });
    createClient.mockReturnValue(client);
    mockDb.accountMember.findUnique.mockResolvedValue({
      userId: "user-1",
      accountId: "acct-1",
      role: "superadmin",
    });
    const err = await getCurrentAccount().catch((e) => e);
    expect(err).toBeInstanceOf(ForbiddenError);
    expect(err.message).toMatch(/Unknown account role/);
  });

  it("rejects an account_id that resolves to no account", async () => {
    const { client } = makeClient({ id: "user-1" });
    createClient.mockReturnValue(client);
    mockDb.accountMember.findUnique.mockResolvedValue({
      userId: "user-1",
      accountId: "acct-1",
      role: "viewer",
    });
    mockDb.account.findUnique.mockResolvedValue(null);
    await expect(getCurrentAccount()).rejects.toThrow(
      "Profile is not linked to an account",
    );
  });
});
