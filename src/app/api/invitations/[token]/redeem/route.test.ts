import { describe, it, expect, vi, beforeEach } from "vitest";
import { __resetRateLimitForTests } from "@/lib/rate-limit";

vi.mock("@/lib/auth/request", () => ({
  getSessionFromRequest: vi.fn(),
}));

vi.mock("@/lib/auth/invites-db", () => ({
  redeemInvitation: vi.fn(),
}));

import { getSessionFromRequest } from "@/lib/auth/request";
import { redeemInvitation } from "@/lib/auth/invites-db";

import { POST } from "./route";

describe("POST /api/invitations/[token]/redeem", () => {
  beforeEach(() => {
    __resetRateLimitForTests();
    vi.mocked(getSessionFromRequest).mockResolvedValue({
      userId: "user-2",
      accountId: "personal-1",
      role: "owner",
    });
  });

  it("returns 401 when not authenticated", async () => {
    vi.mocked(getSessionFromRequest).mockResolvedValue(null);
    const res = await POST(
      new Request("http://localhost/api/invitations/xyz/redeem", {
        method: "POST",
      }),
      { params: Promise.resolve({ token: "xyz" }) },
    );
    expect(res.status).toBe(401);
  });

  it("returns 400 for an invalid or already-used invitation", async () => {
    vi.mocked(redeemInvitation).mockRejectedValue(
      new Error("Invitation is invalid or already used"),
    );
    const res = await POST(
      new Request("http://localhost/api/invitations/xyz/redeem", {
        method: "POST",
      }),
      { params: Promise.resolve({ token: "xyz" }) },
    );
    expect(res.status).toBe(400);
    expect((await res.json()).error).toMatch(/used/i);
  });

  it("returns 400 for an expired invitation", async () => {
    vi.mocked(redeemInvitation).mockRejectedValue(
      new Error("Invitation has expired"),
    );
    const res = await POST(
      new Request("http://localhost/api/invitations/xyz/redeem", {
        method: "POST",
      }),
      { params: Promise.resolve({ token: "xyz" }) },
    );
    expect(res.status).toBe(400);
    expect((await res.json()).error).toMatch(/expired/i);
  });

  it("redeems with the session user id and returns the account", async () => {
    vi.mocked(redeemInvitation).mockResolvedValue("acc-1");
    const res = await POST(
      new Request("http://localhost/api/invitations/xyz/redeem", {
        method: "POST",
      }),
      { params: Promise.resolve({ token: "xyz" }) },
    );
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, accountId: "acc-1" });
    expect(redeemInvitation).toHaveBeenCalledWith("xyz", "user-2");
  });

  it("returns 400 when the token param is missing", async () => {
    const res = await POST(
      new Request("http://localhost/api/invitations/redeem", {
        method: "POST",
      }),
      { params: Promise.resolve({ token: "" }) },
    );
    expect(res.status).toBe(400);
  });
});
