import { createHash, randomBytes } from "crypto";
import { prisma } from "@/lib/db/prisma";

const SESSION_TTL_MS = 1000 * 60 * 60 * 24 * 30; // 30 days
const RENEW_AFTER_MS = 1000 * 60 * 60 * 24 * 7; // renew if lastSeen > 7 days

export function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export async function createSession(userId: string): Promise<{ token: string; expiresAt: Date }> {
  const token = randomBytes(48).toString("hex");
  const expiresAt = new Date(Date.now() + SESSION_TTL_MS);
  await prisma.session.create({
    data: { userId, tokenHash: hashToken(token), expiresAt },
  });
  return { token, expiresAt };
}

export async function getSessionUser(
  token: string,
): Promise<{ userId: string; accountId: string; role: string } | null> {
  const session = await prisma.session.findUnique({ where: { tokenHash: hashToken(token) } });
  if (!session) return null;
  if (session.expiresAt.getTime() < Date.now()) {
    await prisma.session.delete({ where: { id: session.id } }).catch(() => {});
    return null;
  }
  const membership = await prisma.accountMember.findUnique({ where: { userId: session.userId } });
  if (!membership) return null;

  // Sliding renewal — extend session if last seen more than RENEW_AFTER_MS ago
  if (Date.now() - session.lastSeenAt.getTime() > RENEW_AFTER_MS) {
    await prisma.session.update({
      where: { id: session.id },
      data: { lastSeenAt: new Date(), expiresAt: new Date(Date.now() + SESSION_TTL_MS) },
    });
  }
  return { userId: session.userId, accountId: membership.accountId, role: membership.role };
}

export async function deleteSession(token: string): Promise<void> {
  await prisma.session.delete({ where: { tokenHash: hashToken(token) } }).catch(() => {});
}

export async function deleteAllSessions(userId: string): Promise<void> {
  await prisma.session.deleteMany({ where: { userId } });
}
