// ============================================================
// POST /api/openwa/messages/send
//
// Agent-facing send for the OpenWA line. Resolves (or creates) the
// conversation scoped to provider="openwa", then delegates to the
// shared send core (`sendMessageToConversation`), which dispatches
// on the conversation's provider and calls the OpenWA gateway.
// ============================================================

import { NextResponse } from 'next/server';
import { requireRole, toErrorResponse } from '@/lib/auth/account';
import { checkRateLimit, rateLimitResponse, RATE_LIMITS } from '@/lib/rate-limit';
import {
  sendMessageToConversation,
  validateSendMessageParams,
  SendMessageError,
} from '@/lib/whatsapp/send-message';
import { prisma } from '@/lib/db/prisma';

export async function POST(request: Request) {
  try {
    const { accountId, userId } = await requireRole('agent');

    const limit = checkRateLimit(`openwa-send:${userId}`, RATE_LIMITS.send);
    if (!limit.success) {
      return rateLimitResponse(limit);
    }

    const body = await request.json();
    const {
      contact_id,
      conversation_id,
      message_type,
      content_text,
      media_url,
      filename,
      reply_to_message_id,
    } = body;

    if ((!contact_id && !conversation_id) || !message_type) {
      return NextResponse.json(
        {
          error: 'Either contact_id or conversation_id, plus message_type, are required',
        },
        { status: 400 }
      );
    }

    try {
      validateSendMessageParams({
        messageType: message_type,
        contentText: content_text,
        mediaUrl: media_url,
      });
    } catch (err) {
      if (err instanceof SendMessageError) {
        return NextResponse.json({ error: err.message }, { status: err.status });
      }
      throw err;
    }

    let conversationId: string;
    if (conversation_id) {
      const existing = await prisma.conversation.findFirst({
        where: { id: conversation_id, accountId, provider: 'openwa' },
        select: { id: true },
      });
      if (!existing) {
        return NextResponse.json({ error: 'Conversation not found' }, { status: 404 });
      }
      conversationId = existing.id;
    } else {
      // contact_id path — verify ownership, then find-or-create the
      // OpenWA-scoped conversation.
      const contact = await prisma.contact.findFirst({
        where: { id: contact_id, accountId },
        select: { id: true },
      });
      if (!contact) {
        return NextResponse.json({ error: 'Contact not found' }, { status: 404 });
      }

      const existing = await prisma.conversation.findUnique({
        where: {
          accountId_contactId_provider: {
            accountId,
            contactId: contact_id,
            provider: 'openwa',
          },
        },
        select: { id: true },
      });

      if (existing) {
        conversationId = existing.id;
      } else {
        const created = await prisma.conversation.create({
          data: {
            accountId,
            userId,
            contactId: contact_id,
            provider: 'openwa',
          },
          select: { id: true },
        });
        conversationId = created.id;
      }
    }

    try {
      const result = await sendMessageToConversation(null, accountId, {
        conversationId,
        messageType: message_type,
        contentText: content_text,
        mediaUrl: media_url,
        filename: filename ?? null,
        replyToMessageId: reply_to_message_id ?? null,
      });

      return NextResponse.json({
        success: true,
        message_id: result.messageId,
        whatsapp_message_id: result.whatsappMessageId,
        provider: 'openwa',
      });
    } catch (err) {
      if (err instanceof SendMessageError) {
        return NextResponse.json({ error: err.message }, { status: err.status });
      }
      throw err;
    }
  } catch (err) {
    return toErrorResponse(err);
  }
}
