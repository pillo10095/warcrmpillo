import { describe, it, expect, vi } from "vitest";
import { withAccountScope } from "./scoped";

const PRISMA_MOCK = {
  message: {
    findMany: vi.fn().mockResolvedValue([]),
    findFirst: vi.fn().mockResolvedValue(null),
    update: vi.fn().mockResolvedValue(null),
    delete: vi.fn().mockResolvedValue(null),
    create: vi.fn().mockResolvedValue(null),
  },
  user: { findUnique: vi.fn().mockResolvedValue(null) },
};

describe("withAccountScope", () => {
  it("injects accountId into where for findMany on scoped models", async () => {
    const scoped = withAccountScope("acc-1", PRISMA_MOCK as any);
    await scoped.message.findMany({ where: { status: "open" } });
    expect(PRISMA_MOCK.message.findMany).toHaveBeenCalledWith({
      where: { status: "open", accountId: "acc-1" },
    });
  });

  it("does not inject accountId for unscoped models like user", async () => {
    const scoped = withAccountScope("acc-1", PRISMA_MOCK as any);
    await scoped.user.findUnique({ where: { id: "u1" } });
    expect(PRISMA_MOCK.user.findUnique).toHaveBeenCalledWith({
      where: { id: "u1" },
    });
  });
});
