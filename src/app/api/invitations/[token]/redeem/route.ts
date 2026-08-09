// ============================================================
// POST /api/invitations/[token]/redeem
//
// Authenticated. Caller atomically moves from their personal
// account (created at signup) to the inviter's account with the
// invite's role. Heavy lifting lives in `redeemInvitation`
// (src/lib/auth/invites-db.ts), which upserts the membership and
// stamps the invitation accepted in a single transaction.
//
// Refusal contract (kept from the old Supabase RPC)
//   - 401 — caller not authenticated
//   - 400 — invitation not_found / used / expired
//
// Rate limit (per IP) is the same shape as peek but tighter —
// a successful redeem changes data, and the data-loss guard makes
// brute-force retries pointless past a few attempts.
// ============================================================

import { NextResponse } from "next/server";

import { getSessionFromRequest } from "@/lib/auth/request";
import { redeemInvitation } from "@/lib/auth/invites-db";
import {
  checkRateLimit,
  rateLimitResponse,
  RATE_LIMITS,
} from "@/lib/rate-limit";

function getClientIp(request: Request): string {
  const xff = request.headers.get("x-forwarded-for");
  if (xff) return xff.split(",")[0].trim();
  const xri = request.headers.get("x-real-ip");
  if (xri) return xri.trim();
  return "unknown";
}

function redeemErrorToResponse(err: unknown): NextResponse {
  if (err instanceof Error) {
    if (/used/i.test(err.message)) {
      return NextResponse.json({ error: err.message }, { status: 400 });
    }
    if (/expired/i.test(err.message)) {
      return NextResponse.json({ error: err.message }, { status: 400 });
    }
  }
  console.error("[redeem] unexpected error:", err);
  return NextResponse.json(
    { error: "Failed to redeem invitation" },
    { status: 500 },
  );
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ token: string }> },
) {
  const ip = getClientIp(request);
  const limit = checkRateLimit(`redeem:${ip}`, RATE_LIMITS.invitationRedeem);
  if (!limit.success) return rateLimitResponse(limit);

  const { token } = await params;
  if (!token || typeof token !== "string") {
    return NextResponse.json(
      { error: "Missing invitation token" },
      { status: 400 },
    );
  }

  const user = await getSessionFromRequest(request);
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const accountId = await redeemInvitation(token, user.userId);
    return NextResponse.json({ ok: true, accountId });
  } catch (err) {
    return redeemErrorToResponse(err);
  }
}
