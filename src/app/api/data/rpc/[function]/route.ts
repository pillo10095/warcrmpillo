import { type NextRequest } from "next/server";
import { cookies } from "next/headers";
import { prisma } from "@/lib/db/prisma";
import { getSessionUser } from "@/lib/auth/session";
import { SESSION_COOKIE } from "@/lib/auth/cookies";

export const runtime = "nodejs";

async function authenticate() {
  const cookieStore = await cookies();
  const token = cookieStore.get(SESSION_COOKIE)?.value;
  if (!token) return null;
  return getSessionUser(token);
}

// ── RPC handlers ─────────────────────────────────────────────────
//
// Parameter naming follows the original Postgres function signatures
// (supabase/migrations/*): every param a caller sends is prefixed
// `p_` (e.g. `p_status`, `p_automation_id`). The handlers must read
// the SAME names the callers send — dropping the prefix here silently
// broke presence, counters, the tag filter, RAG retrieval, the AI
// auto-reply slot claim, and broadcast creation after the Prisma
// migration (commit 251fe66).

const handlers: Record<
  string,
  (params: Record<string, unknown>, userId: string, accountId: string) => Promise<unknown>
> = {
  // Presence heartbeat
  touch_presence: async (params, userId, accountId) => {
    const status = (params.p_status as string) || "online";
    await prisma.memberPresence.upsert({
      where: { userId },
      update: { status, lastSeenAt: new Date() },
      create: { userId, accountId, status, lastSeenAt: new Date() },
    });
    return null;
  },

  // Record webhook failure
  record_webhook_failure: async (params) => {
    const endpointId = params.endpoint_id as string;
    await prisma.webhookEndpoint.update({
      where: { id: endpointId },
      data: { failureCount: { increment: 1 } },
    });
    return null;
  },

  // Increment automation execution count
  increment_automation_execution_count: async (params) => {
    const automationId = params.p_automation_id as string;
    await prisma.automation.update({
      where: { id: automationId },
      data: {
        executionCount: { increment: 1 },
        lastExecutedAt: new Date(),
      },
    });
    return null;
  },

  // Increment flow execution count
  increment_flow_execution_count: async (params) => {
    const flowId = params.p_flow_id as string;
    await prisma.flow.update({
      where: { id: flowId },
      data: {
        executionCount: { increment: 1 },
        lastExecutedAt: new Date(),
      },
    });
    return null;
  },

  // Filter contacts by tags (search + pagination + total count)
  filter_contacts_by_tags: async (params, _userId, accountId) => {
    const tagIds = (params.p_tag_ids as string[]) ?? [];
    if (!tagIds || tagIds.length === 0) return [];

    const search = typeof params.p_search === "string" ? params.p_search.trim() : null;
    const limit = Math.max(1, Math.min((params.p_limit as number) || 25, 1000));
    const offset = Math.max(0, (params.p_offset as number) || 0);

    const where = {
      accountId,
      contactTags: {
        some: { tagId: { in: tagIds } },
      },
      ...(search
        ? {
            OR: [
              { name: { contains: search } },
              { phone: { contains: search } },
              { email: { contains: search } },
            ],
          }
        : {}),
    };

    const [contacts, totalCount] = await Promise.all([
      prisma.contact.findMany({
        where,
        orderBy: { createdAt: "desc" },
        skip: offset,
        take: limit,
      }),
      prisma.contact.count({ where }),
    ]);

    // Matches the PostgREST `TABLE (contact contacts, total_count BIGINT)`
    // contract of migration 025 — the Contacts page maps `r.contact` and
    // reads `rows[0].total_count`.
    return contacts.map((contact) => ({ contact, total_count: totalCount }));
  },

  // Full-text search on AI knowledge chunks
  match_ai_knowledge_fts: async (params, _userId, accountId) => {
    const query = params.p_query as string;
    const matchCount = Math.max(1, (params.p_match_count as number) || 5);

    if (!query) return [];

    // LIKE search — MySQL lacks pgvector and no FULLTEXT index is defined
    // for ai_knowledge_chunks, so MATCH() AGAINST() would fail at runtime.
    const chunks = await prisma.aiKnowledgeChunk.findMany({
      where: {
        accountId,
        content: { contains: query },
      },
      orderBy: { createdAt: "desc" },
      take: matchCount,
      select: {
        id: true,
        documentId: true,
        content: true,
      },
    });

    return chunks;
  },

  // Semantic search (pgvector — unsupported on MySQL)
  match_ai_knowledge_semantic: async (params, _userId, _accountId) => {
    const matchCount = Math.max(1, (params.p_match_count as number) || 5);

    // The caller only sends `p_query_embedding` (a vector literal). MySQL
    // cannot do cosine similarity, so return [] and let the FTS top-up in
    // src/lib/ai/knowledge.ts cover retrieval.
    void matchCount;
    return [];
  },

  // Atomic auto-reply slot claim (migration 029) — true when a slot was
  // claimed, false when the per-conversation cap is already reached.
  claim_ai_reply_slot: async (params, _userId, _accountId) => {
    const conversationId = params.conversation_id as string;
    const maxReplies = (params.max_replies as number) ?? 1;

    if (!conversationId || maxReplies < 1) return false;

    const result = await prisma.conversation.updateMany({
      where: {
        id: conversationId,
        aiReplyCount: { lt: maxReplies },
      },
      data: { aiReplyCount: { increment: 1 } },
    });

    return result.count > 0;
  },

  // Create a broadcast + its recipient rows in one transaction (migration
  // 037) — an atomic insert so a recipient failure rolls the parent back.
  create_broadcast_with_recipients: async (params, _userId, _accountId) => {
    const { accountId, userId, name, templateName, templateLanguage, totalRecipients, contactIds } = {
      accountId: params.p_account_id as string,
      userId: params.p_user_id as string,
      name: params.p_name as string,
      templateName: params.p_template_name as string,
      templateLanguage: (params.p_template_language as string) || "en_US",
      totalRecipients: (params.p_total_recipients as number) || 0,
      contactIds: (params.p_contact_ids as string[]) ?? [],
    };

    if (!accountId || !userId || !name || !templateName || contactIds.length === 0) {
      return [];
    }

    const rows = await prisma.$transaction(async (tx) => {
      const broadcast = await tx.broadcast.create({
        data: {
          accountId,
          userId,
          name,
          templateName,
          templateLanguage,
          totalRecipients,
          status: "sending",
        },
      });

      const recipients = [];
      for (const contactId of contactIds) {
        const recipient = await tx.broadcastRecipient.create({
          data: { broadcastId: broadcast.id, contactId, status: "pending" },
        });
        recipients.push({ broadcast_id: broadcast.id, recipient_id: recipient.id, contact_id: recipient.contactId });
      }
      return recipients;
    });

    return rows;
  },
};

// ── POST handler ─────────────────────────────────────────────────

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ function: string }> },
) {
  const { function: fnName } = await params;

  const user = await authenticate();
  if (!user) {
    return Response.json(
      { data: null, error: { message: "Unauthorized", code: "401" } },
      { status: 401 },
    );
  }

  const handler = handlers[fnName];
  if (!handler) {
    return Response.json(
      { data: null, error: { message: `Unknown function: ${fnName}`, code: "404" } },
      { status: 404 },
    );
  }

  const body = await request.json().catch(() => ({}));

  try {
    const result = await handler(body, user.userId, user.accountId);
    return Response.json({ data: result, error: null });
  } catch (e: any) {
    return Response.json(
      {
        data: null,
        error: { message: e.message ?? "RPC failed", code: "500" },
      },
      { status: 500 },
    );
  }
}
