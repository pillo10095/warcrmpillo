import { createHash, randomBytes } from "crypto";
import { prisma } from "@/lib/db/prisma";
import type { AccountRole } from "@prisma/client";

export function hashInviteToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export async function createInvitation(
  accountId: string,
  invitedBy: string,
  role: AccountRole,
  opts: { label?: string; expiresInDays?: number } = {},
): Promise<{ token: string; expiresAt: Date }> {
  const token = randomBytes(32).toString("base64url");
  const expiresAt = new Date(Date.now() + 1000 * 60 * 60 * 24 * (opts.expiresInDays ?? 7));
  await prisma.invitation.create({
    data: {
      accountId,
      tokenHash: hashInviteToken(token),
      role,
      createdByUserId: invitedBy,
      label: opts.label ?? null,
      expiresAt,
    },
  });
  return { token, expiresAt };
}

export async function redeemInvitation(token: string, userId: string): Promise<string> {
  const invitation = await prisma.invitation.findUnique({
    where: { tokenHash: hashInviteToken(token) },
  });
  if (!invitation || invitation.acceptedAt) {
    throw new Error("Invitation is invalid or already used");
  }
  if (invitation.expiresAt.getTime() < Date.now()) {
    throw new Error("Invitation has expired");
  }

  await prisma.$transaction(async (tx) => {
    await tx.accountMember.upsert({
      where: { userId },
      create: { userId, accountId: invitation.accountId, role: invitation.role },
      update: { accountId: invitation.accountId, role: invitation.role },
    });
    await tx.invitation.update({
      where: { id: invitation.id },
      data: { acceptedAt: new Date(), acceptedByUserId: userId },
    });
  });

  return invitation.accountId;
}
