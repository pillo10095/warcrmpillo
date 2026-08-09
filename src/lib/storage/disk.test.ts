import { describe, it, expect, vi, beforeEach } from "vitest";
import { saveFile } from "./disk";

const mockDb = vi.hoisted(() => ({
  fileRecord: {
    create: vi.fn().mockResolvedValue({ id: "f-1" }),
    findUnique: vi.fn(),
    delete: vi.fn().mockResolvedValue(undefined),
  },
}));

vi.mock("@/lib/db/prisma", () => ({ prisma: mockDb }));
vi.mock("fs/promises", () => ({
  mkdir: vi.fn().mockResolvedValue(undefined),
  writeFile: vi.fn().mockResolvedValue(undefined),
  readFile: vi.fn().mockResolvedValue(Buffer.from("x")),
  rm: vi.fn().mockResolvedValue(undefined),
}));

describe("saveFile", () => {
  beforeEach(() => vi.clearAllMocks());

  it("stores a file record and returns an id + url", async () => {
    const { id, url } = await saveFile({
      accountId: "acc-1",
      originalName: "photo.png",
      mime: "image/png",
      buffer: Buffer.from("x"),
    });
    expect(id).toBe("f-1");
    expect(url).toContain("/api/files/f-1");
    const data = mockDb.fileRecord.create.mock.calls[0][0].data;
    expect(data.diskPath).toMatch(/[0-9a-f-]{36}\.png$/);
  });

  it("never stores the original filename in the path", async () => {
    await saveFile({
      accountId: "acc-1",
      originalName: "photo.png",
      mime: "image/png",
      buffer: Buffer.from("x"),
    });
    const data = mockDb.fileRecord.create.mock.calls[0][0].data;
    expect(data.diskPath).not.toContain("photo");
  });
});
