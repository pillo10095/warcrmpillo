// ============================================================
// /api/account/members/[userId]
//
//   PATCH  — change a member's role.   Admin+.
//   DELETE — remove a member.          Admin+.
//
// The old SECURITY DEFINER RPCs (migration 018) did the *real*
// authorisation work. Now that the app runs on MySQL, those
// guards are replicated here in TS with plain Prisma writes, and
// both mutations run inside a transaction:
//   - set_member_role  -> accountMember.update (PATCH)
//   - remove_account_member -> fresh personal account + member
//     move (DELETE)
//
// Guards (mirroring the RPCs): caller must be admin+, target must
// be in caller's account, target can't be the owner, can't be
// self.
// ============================================================

import { NextResponse } from "next/server";

import { getSessionFromRequest, type SessionUser } from "@/lib/auth/request";
import { canManageMembers, isAccountRole, type AccountRole } from "@/lib/auth/roles";
import { prisma } from "@/lib/db/prisma";
import {
  checkRateLimit,
  rateLimitResponse,
  RATE_LIMITS,
} from "@/lib/rate-limit";

/**
 * Resolve the caller from the session cookie and enforce admin+.
 * Returns the resolved session user, or an error response to
 * return directly.
 */
async function requireAdmin(request: Request): Promise<SessionUser | NextResponse> {
  const user = await getSessionFromRequest(request);
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (!canManageMembers(user.role as AccountRole)) {
    return NextResponse.json(
      { error: "This action requires the 'admin' role or higher" },
      { status: 403 },
    );
  }
  return user;
}

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ userId: string }> },
) {
  try {
    const ctx = await requireAdmin(request);
    if (ctx instanceof NextResponse) return ctx;

    const limit = checkRateLimit(
      `admin:memberRole:${ctx.userId}`,
      RATE_LIMITS.adminAction,
    );
    if (!limit.success) return rateLimitResponse(limit);

    const { userId } = await params;

    const body = (await request.json().catch(() => null)) as
      | { role?: unknown }
      | null;
    const role = body?.role;

    if (!isAccountRole(role)) {
      return NextResponse.json(
        { error: "'role' must be one of owner, admin, agent, viewer" },
        { status: 400 },
      );
    }

    // Promotion to / demotion from owner goes through
    // transfer-ownership; surface the friendlier 400 here too.
    if (role === "owner") {
      return NextResponse.json(
        {
          error:
            "Use POST /api/account/transfer-ownership to promote a member to owner",
        },
        { status: 400 },
      );
    }

    if (userId === ctx.userId) {
      return NextResponse.json(
        { error: "Cannot change your own role" },
        { status: 400 },
      );
    }

    const target = await prisma.accountMember.findUnique({
      where: { userId },
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
    if (target.role === "owner") {
      return NextResponse.json(
        { error: "Use transfer_account_ownership to demote an owner" },
        { status: 400 },
      );
    }

    await prisma.accountMember.update({
      where: { userId },
      data: { role },
    });

    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("[members route] unexpected error:", err);
    return NextResponse.json(
      { error: "Failed to update member" },
      { status: 500 },
    );
  }
}

export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ userId: string }> },
) {
  try {
    const ctx = await requireAdmin(request);
    if (ctx instanceof NextResponse) return ctx;

    const limit = checkRateLimit(
      `admin:memberRemove:${ctx.userId}`,
      RATE_LIMITS.adminAction,
    );
    if (!limit.success) return rateLimitResponse(limit);

    const { userId } = await params;

    if (userId === ctx.userId) {
      return NextResponse.json(
        { error: "Cannot remove yourself; transfer ownership or leave the account instead" },
        { status: 400 },
      );
    }

    const target = await prisma.accountMember.findUnique({
      where: { userId },
      include: { user: { select: { fullName: true, email: true } } },
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
    if (target.role === "owner") {
      return NextResponse.json(
        { error: "Cannot remove the account owner; transfer ownership first" },
        { status: 400 },
      );
    }

    // Mirror of remove_account_member: spin up a fresh personal
    // account for the removed user and move them there as owner —
    // they keep their login and "start over" with an empty account.
    const newAccount = await prisma.$transaction(async (tx) => {
      const account = await tx.account.create({
        data: {
          name: target.user.fullName || target.user.email || "My account",
          ownerUserId: userId,
        },
        select: { id: true },
      });
      await tx.accountMember.update({
        where: { userId },
        data: { accountId: account.id, role: "owner" },
      });
      return account;
    });

    return NextResponse.json({
      ok: true,
      newPersonalAccountId: newAccount.id,
    });
  } catch (err) {
    console.error("[members route] unexpected error:", err);
    return NextResponse.json(
      { error: "Failed to update member" },
      { status: 500 },
    );
  }
}
