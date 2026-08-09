import { describe, it, expect, vi } from "vitest";
import { getSessionFromRequest } from "./request";
import { SESSION_COOKIE } from "./cookies";

vi.mock("./session", () => ({
  getSessionUser: vi.fn().mockResolvedValue({ userId: "u", accountId: "a", role: "owner" }),
}));

describe("getSessionFromRequest", () => {
  it("reads the session cookie and validates it", async () => {
    const req = new Request("http://localhost/inbox", {
      headers: { cookie: `${SESSION_COOKIE}=tok123` },
    });
    const session = await getSessionFromRequest(req);
    expect(session).toEqual({ userId: "u", accountId: "a", role: "owner" });
  });

  it("returns null when no cookie", async () => {
    const req = new Request("http://localhost/inbox");
    expect(await getSessionFromRequest(req)).toBeNull();
  });
});
