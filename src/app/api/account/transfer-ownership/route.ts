// ============================================================
// POST /api/account/transfer-ownership
//
// Owner only. Atomically:
//   - demotes the current owner to 'admin'
//   - promotes the target member to 'owner'
//   - updates accounts.owner_user_id
//
// The old SECURITY DEFINER RPC (migration 018) did this in one
// statement-level transaction; now it's a single Prisma
// transaction guarded here in TS.
//
// Why a separate endpoint instead of PATCH /members/[userId]?
//   The semantics differ: transfer demotes the current owner as
//   a side-effect and changes the owner_user_id pointer on
//   `accounts`. Making it explicit prevents the "I clicked the
//   role dropdown by mistake" failure mode where an admin would
//   silently hand their account away.
// ============================================================

import { NextResponse } from "next/server";

import { getSessionFromRequest, type SessionUser } from "@/lib/auth/request";
import { canTransferOwnership, type AccountRole } from "@/lib/auth/roles";
import { prisma } from "@/lib/db/prisma";
import {
  checkRateLimit,
  rateLimitResponse,
  RATE_LIMITS,
} from "@/lib/rate-limit";

/**
 * Resolve the caller from the session cookie and enforce owner.
 * Returns the resolved session user, or an error response to
 * return directly.
 */
async function requireOwner(request: Request): Promise<SessionUser | NextResponse> {
  const user = await getSessionFromRequest(request);
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (!canTransferOwnership(user.role as AccountRole)) {
    return NextResponse.json(
      { error: "This action requires the 'owner' role or higher" },
      { status: 403 },
    );
  }
  return user;
}

// Crude shape check — full UUID validation happens DB-side when
// the FK / lookup runs. This guards against obviously-wrong input
// (numbers, objects) before we round-trip.
function looksLikeUuid(v: unknown): v is string {
  return (
    typeof v === "string" &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v)
  );
}

export async function POST(request: Request) {
  try {
    const ctx = await requireOwner(request);
    if (ctx instanceof NextResponse) return ctx;

    // Rate-limit owner-only transfers. Legitimate use is one click
    // every few months at most; a script run in a loop would
    // produce a noisy audit trail. 30/min is well above any human
    // pace and bounds the noise.
    const limit = checkRateLimit(
      `admin:transferOwnership:${ctx.userId}`,
      RATE_LIMITS.adminAction,
    );
    if (!limit.success) return rateLimitResponse(limit);

    const body = (await request.json().catch(() => null)) as
      | { newOwnerUserId?: unknown }
      | null;
    const newOwnerUserId = body?.newOwnerUserId;

    if (!looksLikeUuid(newOwnerUserId)) {
      return NextResponse.json(
        { error: "'newOwnerUserId' must be a valid UUID" },
        { status: 400 },
      );
    }

    if (newOwnerUserId === ctx.userId) {
      return NextResponse.json(
        { error: "You are already the owner" },
        { status: 400 },
      );
    }

    const target = await prisma.accountMember.findUnique({
      where: { userId: newOwnerUserId },
    });

    if (!target) {
      return NextResponse.json(
        { error: "Target user not found" },
        { status: 400 },
      );
    }
    if (target.accountId !== ctx.accountId) {
      return NextResponse.json(
        { error: "Target user is not a member of your account" },
        { status: 403 },
      );
    }

    // Demote the current owner first so the temporary state where
    // the account has zero owners is never visible — both writes
    // happen in the same transaction.
    await prisma.$transaction(async (tx) => {
      await tx.account.update({
        where: { id: ctx.accountId },
        data: { ownerUserId: newOwnerUserId },
      });
      await tx.accountMember.update({
        where: { userId: ctx.userId },
        data: { role: "admin" },
      });
      await tx.accountMember.update({
        where: { userId: newOwnerUserId },
        data: { role: "owner" },
      });
    });

    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("[transfer-ownership] unexpected error:", err);
    return NextResponse.json(
      { error: "Failed to transfer ownership" },
      { status: 500 },
    );
  }
}
