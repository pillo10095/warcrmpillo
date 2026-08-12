import { type NextRequest } from "next/server";
import { cookies } from "next/headers";
import { prisma } from "@/lib/db/prisma";
import { getSessionUser } from "@/lib/auth/session";
import { SESSION_COOKIE } from "@/lib/auth/cookies";
import { ok, err } from "@/lib/api/data/query-builder";

export const runtime = "nodejs";

async function authenticate() {
  const cookieStore = await cookies();
  const token = cookieStore.get(SESSION_COOKIE)?.value;
  if (!token) return null;
  return getSessionUser(token);
}

// ── RPC implementations ──────────────────────────────────────────

async function touchPresence(
  userId: string,
  accountId: string,
  params: Record<string, unknown>,
) {
  const status = typeof params.status === "string" ? params.status : "online";
  const result = await prisma.memberPresence.upsert({
    where: { userId },
    create: { userId, accountId, status, lastSeenAt: new Date() },
    update: { status, lastSeenAt: new Date() },
  });
  return result;
}

async function filterContactsByTags(
  userId: string,
  accountId: string,
  params: Record<string, unknown>,
) {
  const tagIds = Array.isArray(params.tag_ids) ? params.tag_ids as string[] : [];
  if (tagIds.length === 0) return [];

  const contacts = await prisma.contact.findMany({
    where: {
      accountId,
      contactTags: {
        some: {
          tagId: { in: tagIds },
        },
      },
    },
    include: {
      contactTags: {
        include: { tag: true },
      },
    },
  });

  return contacts;
}

// ── RPC dispatcher ───────────────────────────────────────────────

const RPC_HANDLERS: Record<
  string,
  (
    userId: string,
    accountId: string,
    params: Record<string, unknown>,
  ) => Promise<unknown>
> = {
  touch_presence: touchPresence,
  filter_contacts_by_tags: filterContactsByTags,
};

// ── POST handler ─────────────────────────────────────────────────

export async function POST(request: NextRequest) {
  const user = await authenticate();
  if (!user) return err("Unauthorized", 401);

  const body = await request.json().catch(() => null);
  if (!body || typeof body !== "object") return err("Invalid JSON body");

  const { name, params = {} } = body as {
    name?: string;
    params?: Record<string, unknown>;
  };

  if (!name || typeof name !== "string") {
    return err("Missing RPC function name");
  }

  const handler = RPC_HANDLERS[name];
  if (!handler) {
    return err(`Unknown RPC function: ${name}`, 404);
  }

  try {
    const result = await handler(user.userId, user.accountId, params);
    return ok(result);
  } catch (e: any) {
    return err(e.message ?? "RPC call failed", 500);
  }
}
