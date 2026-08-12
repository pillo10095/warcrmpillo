import { prisma } from "@/lib/db/prisma";

const SESSION_TTL_MS = 1000 * 60 * 60 * 24 * 30; // 30 days
const RENEW_AFTER_MS = 1000 * 60 * 60 * 24 * 7; // renew if lastSeen > 7 days

/** SHA-256 hash using Web Crypto API (Edge-compatible). */
async function sha256(input: string): Promise<string> {
  const data = new TextEncoder().encode(input);
  const hash = await globalThis.crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(hash))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

export async function hashToken(token: string): Promise<string> {
  return sha256(token);
}

function randomHex(bytes: number): string {
  const arr = new Uint8Array(bytes);
  globalThis.crypto.getRandomValues(arr);
  return Array.from(arr)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

export async function createSession(userId: string): Promise<{ token: string; expiresAt: Date }> {
  const token = randomHex(48);
  const expiresAt = new Date(Date.now() + SESSION_TTL_MS);
  await prisma.session.create({
    data: { userId, tokenHash: await hashToken(token), expiresAt },
  });
  return { token, expiresAt };
}

export async function getSessionUser(
  token: string,
): Promise<{ userId: string; accountId: string; role: string } | null> {
  const session = await prisma.session.findUnique({ where: { tokenHash: await hashToken(token) } });
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
  await prisma.session.delete({ where: { tokenHash: await hashToken(token) } }).catch(() => {});
}

export async function deleteAllSessions(userId: string): Promise<void> {
  await prisma.session.deleteMany({ where: { userId } });
}
