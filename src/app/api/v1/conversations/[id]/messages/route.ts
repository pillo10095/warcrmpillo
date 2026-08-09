// ============================================================
// GET /api/v1/conversations/{id}/messages — list a conversation's
// messages (scope: messages:read), newest first, keyset-paginated.
//
// The conversation is verified to belong to the key's account before
// any message is returned — a foreign or unknown id → 404.
//
// Prisma-backed: ownership gate + message query both scoped by
// `ctx.accountId`.
// ============================================================

import type { Prisma } from '@prisma/client';

import { requireApiKey } from '@/lib/auth/api-context';
import { okList, fail, toApiErrorResponse } from '@/lib/api/v1/respond';
import { parseListParams, buildPage } from '@/lib/api/v1/pagination';
import { serializeMessage } from '@/lib/api/v1/conversations';
import { prismaToMessage } from '@/lib/inbox/messages';
import { prisma } from '@/lib/db/prisma';

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const ctx = await requireApiKey(request, 'messages:read');
    const { id } = await params;
    const { limit, cursor } = parseListParams(request);

    // Gate on account ownership of the conversation first.
    const conv = await prisma.conversation.findFirst({
      where: { id, accountId: ctx.accountId },
      select: { id: true },
    });
    if (!conv) return fail('not_found', 'Conversation not found', 404);

    const where: Prisma.MessageWhereInput = { conversationId: id };
    if (cursor) {
      const at = new Date(cursor.createdAt);
      where.OR = [
        { createdAt: { lt: at } },
        { AND: [{ createdAt: at }, { id: { lt: cursor.id } }] },
      ];
    }

    let rows;
    try {
      rows = await prisma.message.findMany({
        where,
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        take: limit + 1,
      });
    } catch (error) {
      console.error('[api/v1/messages] list error:', error);
      return fail('internal', 'Failed to list messages', 500);
    }

    const { items, nextCursor } = buildPage(
      rows.map((r) => ({ created_at: r.createdAt.toISOString(), id: r.id })),
      limit
    );
    const byId = new Map(rows.map((r) => [r.id, r]));
    return okList(
      items.map((r) => serializeMessage(prismaToMessage(byId.get(r.id)!))),
      nextCursor
    );
  } catch (err) {
    return toApiErrorResponse(err);
  }
}
