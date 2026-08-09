import { prisma } from "@/lib/db/prisma";

export interface ApiKeyRow {
  id: string;
  accountId: string;
  createdBy: string | null;
  name: string;
  scopes: string[];
  expiresAt: Date | null;
  revokedAt: Date | null;
}

function parseScopes(raw: string): string[] {
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export async function findActiveKeyByHash(hash: string): Promise<ApiKeyRow | null> {
  const row = await prisma.apiKey.findUnique({ where: { keyHash: hash } });
  if (!row) return null;
  if (row.revokedAt) return null;
  if (row.expiresAt && row.expiresAt.getTime() < Date.now()) return null;
  return {
    id: row.id,
    accountId: row.accountId,
    createdBy: row.createdBy,
    name: row.name,
    scopes: parseScopes(row.scopes),
    expiresAt: row.expiresAt,
    revokedAt: row.revokedAt,
  };
}

export async function getAccountName(accountId: string): Promise<string | null> {
  const account = await prisma.account.findUnique({ where: { id: accountId }, select: { name: true } });
  return account?.name ?? null;
}

export async function touchLastUsed(id: string): Promise<void> {
  await prisma.apiKey.update({ where: { id }, data: { lastUsedAt: new Date() } }).catch(() => {});
}
