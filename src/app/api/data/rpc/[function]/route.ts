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

const handlers: Record<
  string,
  (params: Record<string, unknown>, userId: string, accountId: string) => Promise<unknown>
> = {
  // Presence heartbeat
  touch_presence: async (params, userId, accountId) => {
    const status = (params.status as string) || "online";
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
    const automationId = params.automation_id as string;
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
    const flowId = params.flow_id as string;
    await prisma.flow.update({
      where: { id: flowId },
      data: {
        executionCount: { increment: 1 },
        lastExecutedAt: new Date(),
      },
    });
    return null;
  },

  // Filter contacts by tags
  filter_contacts_by_tags: async (params, _userId, accountId) => {
    const tagIds = params.tag_ids as string[];
    if (!tagIds || tagIds.length === 0) return [];

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
  },

  // Full-text search on AI knowledge chunks
  match_ai_knowledge_fts: async (params, _userId, accountId) => {
    const query = params.query as string;
    const matchCount = (params.match_count as number) || 5;

    if (!query) return [];

    const chunks = await prisma.$queryRaw`
      SELECT id, document_id, content, 
             MATCH(content) AGAINST(${query} IN NATURAL LANGUAGE MODE) AS relevance
      FROM ai_knowledge_chunks
      WHERE account_id = ${accountId}
        AND MATCH(content) AGAINST(${query} IN NATURAL LANGUAGE MODE) > 0
      ORDER BY relevance DESC
      LIMIT ${matchCount}
    `;

    return chunks;
  },

  // Semantic search (pgvector - simplified for MySQL using LIKE)
  match_ai_knowledge_semantic: async (params, _userId, accountId) => {
    const query = params.query as string;
    const matchCount = (params.match_count as number) || 5;

    if (!query) return [];

    // Fallback to LIKE search since MySQL doesn't have pgvector
    const chunks = await prisma.aiKnowledgeChunk.findMany({
      where: {
        accountId,
        content: { contains: query },
      },
      take: matchCount,
      select: {
        id: true,
        documentId: true,
        content: true,
      },
    });

    return chunks;
  },

  // Claim conversation for AI auto-reply
  claim_conversation: async (params, _userId, _accountId) => {
    const conversationId = params.conversation_id as string;

    // Check if already claimed
    const existing = await prisma.conversation.findUnique({
      where: { id: conversationId },
      select: { aiAutoreplyDisabled: true },
    });

    if (existing?.aiAutoreplyDisabled) {
      return { claimed: false, reason: "disabled" };
    }

    // Mark as claimed (increment reply count)
    await prisma.conversation.update({
      where: { id: conversationId },
      data: { aiReplyCount: { increment: 1 } },
    });

    return { claimed: true };
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
