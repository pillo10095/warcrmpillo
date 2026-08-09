// ============================================================
// GET /api/v1/conversations — list conversations (scope: conversations:read)
//
// Keyset-paginated (newest first). Filters: `?status=` (open/pending/
// closed) and `?contact_id=`. Each conversation embeds its contact +
// tags via the shared CONVERSATION_INCLUDE.
//
// Prisma-backed: queries are explicitly scoped by `ctx.accountId`
// (application-level RLS).
// ============================================================

import type { Prisma } from '@prisma/client';

import { requireApiKey } from '@/lib/auth/api-context';
import { okList, fail, toApiErrorResponse } from '@/lib/api/v1/respond';
import { parseListParams, buildPage } from '@/lib/api/v1/pagination';
import {
  CONVERSATION_INCLUDE,
  prismaToConversation,
} from '@/lib/inbox/conversations';
import { serializeConversation } from '@/lib/api/v1/conversations';
import type { ConversationStatus } from '@/types';
import { prisma } from '@/lib/db/prisma';

export async function GET(request: Request) {
  try {
    const ctx = await requireApiKey(request, 'conversations:read');
    const { limit, cursor } = parseListParams(request);
    const url = new URL(request.url);
    const status = url.searchParams.get('status');
    const contactId = url.searchParams.get('contact_id');

    // Filters and the keyset walk are both OR-groups; combine them with
    // AND so they never collide in a single `where.OR`.
    const and: Prisma.ConversationWhereInput[] = [];

    if (status) and.push({ status: status as ConversationStatus });
    if (contactId) and.push({ contactId });
    if (cursor) {
      // Walks *past* the cursor row under a (created_at desc, id desc)
      // ordering — the Prisma equivalent of the PostgREST keyset filter.
      const at = new Date(cursor.createdAt);
      and.push({
        OR: [
          { createdAt: { lt: at } },
          { AND: [{ createdAt: at }, { id: { lt: cursor.id } }] },
        ],
      });
    }

    const where: Prisma.ConversationWhereInput = { accountId: ctx.accountId };
    if (and.length > 0) where.AND = and;

    let rows;
    try {
      rows = await prisma.conversation.findMany({
        where,
        include: CONVERSATION_INCLUDE,
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        take: limit + 1,
      });
    } catch (error) {
      console.error('[api/v1/conversations] list error:', error);
      return fail('internal', 'Failed to list conversations', 500);
    }

    // buildPage expects the `created_at` ISO string the old PostgREST
    // rows carried; feed it a projection, then serialize the originals.
    const { items, nextCursor } = buildPage(
      rows.map((r) => ({ created_at: r.createdAt.toISOString(), id: r.id })),
      limit
    );
    const byId = new Map(rows.map((r) => [r.id, r]));
    return okList(
      items.map((r) =>
        serializeConversation(prismaToConversation(byId.get(r.id)!))
      ),
      nextCursor
    );
  } catch (err) {
    return toApiErrorResponse(err);
  }
}
