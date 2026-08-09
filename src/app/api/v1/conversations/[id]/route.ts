// ============================================================
// GET /api/v1/conversations/{id} — read one conversation
// (scope: conversations:read). Account-scoped: a foreign id → 404.
//
// Prisma-backed: query explicitly scoped by `ctx.accountId`.
// ============================================================

import { requireApiKey } from '@/lib/auth/api-context';
import { ok, fail, toApiErrorResponse } from '@/lib/api/v1/respond';
import {
  CONVERSATION_INCLUDE,
  prismaToConversation,
} from '@/lib/inbox/conversations';
import { serializeConversation } from '@/lib/api/v1/conversations';
import { prisma } from '@/lib/db/prisma';

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const ctx = await requireApiKey(request, 'conversations:read');
    const { id } = await params;

    const row = await prisma.conversation.findFirst({
      where: { id, accountId: ctx.accountId },
      include: CONVERSATION_INCLUDE,
    });
    if (!row) return fail('not_found', 'Conversation not found', 404);

    return ok(serializeConversation(prismaToConversation(row)));
  } catch (err) {
    return toApiErrorResponse(err);
  }
}
