// ============================================================
// POST /api/openwa/webhook
//
// Inbound event receiver for the OpenWA gateway. Mirrors the Meta
// webhook pipeline: verify HMAC → resolve account from the session →
// find-or-create contact/conversation (provider="openwa") → persist
// the message idempotently → fan out to flows/automations/AI/public
// webhooks. Also handles ack/failed (outbound status) and session
// lifecycle events.
//
// The gateway delivers at-least-once, so the handler must be
// idempotent — the (conversation_id, message_id) unique covers it.
//
// Body is read as RAW TEXT, verified, then parsed — exactly like the
// Meta webhook, since the HMAC covers the exact bytes sent.
// ============================================================

import { NextResponse, after } from 'next/server';
import { prisma } from '@/lib/db/prisma';
import { verifyOpenWAWebhookSignature } from '@/lib/whatsapp/openwa-signature';
import { normalizePhone } from '@/lib/whatsapp/phone-utils';
import { findExistingContact } from '@/lib/contacts/duplicate-lookup';
import { isUniqueViolation } from '@/lib/contacts/dedupe';
import { reopenClosedConversation } from '@/lib/conversations/reopen';
import { dispatchInboundToFlows } from '@/lib/flows/engine';
import { runAutomationsForTrigger } from '@/lib/automations/engine';
import { dispatchInboundToAiReply } from '@/lib/ai/auto-reply';
import { dispatchWebhookEvent } from '@/lib/webhooks/deliver';
import type { ContentType } from '@prisma/client';

export const maxDuration = 60;

interface OpenWADelivery {
  event: string;
  timestamp: string;
  sessionId: string;
  idempotencyKey: string;
  deliveryId: string;
  data: Record<string, unknown>;
}

export async function POST(request: Request) {
  const rawBody = await request.text();
  const signature = request.headers.get('x-openwa-signature');

  if (!verifyOpenWAWebhookSignature(rawBody, signature)) {
    return NextResponse.json({ error: 'Invalid signature' }, { status: 401 });
  }

  let delivery: OpenWADelivery;
  try {
    delivery = JSON.parse(rawBody) as OpenWADelivery;
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  if (!delivery.sessionId) {
    return NextResponse.json({ error: 'Missing sessionId' }, { status: 400 });
  }

  // Resolve the account + audit user for this session.
  const session = await prisma.openWASession.findFirst({
    where: {
      OR: [
        { openwaSessionId: delivery.sessionId },
        { name: delivery.sessionId },
      ],
    },
    include: { config: { include: { account: { select: { ownerUserId: true } } } } },
  });

  if (!session) {
    console.warn(
      `[openwa/webhook] event for unknown session "${delivery.sessionId}" (${delivery.event})`
    );
    return NextResponse.json({ error: 'Unknown session' }, { status: 404 });
  }

  const accountId = session.config.accountId;
  const ownerUserId = session.config.account.ownerUserId;

  // Ack early; heavy processing runs after the response.
  after(async () => {
    try {
      await handleEvent(delivery, accountId, ownerUserId, session.openwaSessionId);
    } catch (err) {
      console.error('[openwa/webhook] event processing failed:', err);
    }
  });

  return NextResponse.json({ status: 'received' });
}

async function handleEvent(
  delivery: OpenWADelivery,
  accountId: string,
  ownerUserId: string,
  openwaSessionId: string
): Promise<void> {
  switch (delivery.event) {
    case 'message.received':
      await handleInboundMessage(delivery, accountId, ownerUserId);
      break;
    case 'message.ack':
    case 'message.failed':
      await handleAck(delivery, accountId);
      break;
    case 'session.authenticated':
    case 'session.status':
      await handleSessionState(delivery, accountId, openwaSessionId);
      break;
    default:
      // session.qr, session.disconnected, group.*, call.* etc. — not
      // handled yet; acknowledge so the gateway stops retrying.
      break;
  }
}

// ============================================================
// Inbound message
// ============================================================

function messageTypeToContentType(type: string): ContentType {
  switch (type) {
    case 'image':
    case 'sticker':
      return 'image';
    case 'video':
      return 'video';
    case 'audio':
      return 'audio';
    case 'document':
      return 'document';
    case 'location':
      return 'location';
    default:
      return 'text';
  }
}

async function handleInboundMessage(
  delivery: OpenWADelivery,
  accountId: string,
  ownerUserId: string
): Promise<void> {
  const data = delivery.data as {
    id?: string;
    from?: string;
    to?: string;
    body?: string;
    type?: string;
    timestamp?: number;
    isGroup?: boolean;
    kind?: string;
    hasMedia?: boolean;
    contact?: { name?: string; pushName?: string };
    media?: { url?: string; mimeType?: string } | null;
  };

  if (data.isGroup) {
    // Group threads aren't modelled as contacts/conversations yet.
    return;
  }

  const messageId = data.id;
  if (!messageId) {
    console.warn('[openwa/webhook] inbound message without id, skipping');
    return;
  }

  const phone = normalizePhone(data.from ?? '');
  if (!phone) {
    console.warn(
      `[openwa/webhook] inbound message "${messageId}" has no parsable sender, skipping`
    );
    return;
  }

  // ---- contact find-or-create (same dedup as the Meta webhook) ----
  let contact = await findExistingContact(null, accountId, phone);
  const contactName =
    data.contact?.pushName || data.contact?.name || phone;
  let wasCreated = false;

  if (contact) {
    if (contact.name !== contactName) {
      await prisma.contact.update({
        where: { id: contact.id },
        data: { name: contactName, updatedAt: new Date() },
      });
    }
  } else {
    try {
      contact = await prisma.contact.create({
        data: {
          accountId,
          userId: ownerUserId,
          phone,
          phoneNormalized: phone,
          name: contactName,
        },
        select: { id: true, name: true, phone: true },
      });
      wasCreated = true;
    } catch (err) {
      if (isUniqueViolation(err)) {
        // Concurrent delivery created it first — re-resolve.
        contact = await findExistingContact(null, accountId, phone);
      } else {
        throw err;
      }
    }
  }
  if (!contact) {
    throw new Error('Failed to resolve contact for inbound message');
  }
  const contactId = contact.id;

  // ---- conversation find-or-create (provider-scoped) ----
  let conversation = await prisma.conversation.findFirst({
    where: { accountId, contactId, provider: 'openwa' },
    orderBy: { createdAt: 'asc' },
  });
  let conversationCreated = false;

  if (!conversation) {
    try {
      conversation = await prisma.conversation.create({
        data: { accountId, userId: ownerUserId, contactId, provider: 'openwa' },
      });
      conversationCreated = true;
    } catch (err) {
      if (isUniqueViolation(err)) {
        conversation = await prisma.conversation.findFirst({
          where: { accountId, contactId, provider: 'openwa' },
          orderBy: { createdAt: 'asc' },
        });
      } else {
        throw err;
      }
    }
  }
  if (!conversation) {
    throw new Error('Failed to resolve conversation for inbound message');
  }

  const contentType = messageTypeToContentType(data.type ?? 'text');
  const body = data.body || '';

  // ---- message insert (idempotent on conversationId+messageId) ----
  const existingMessage = await prisma.message.findUnique({
    where: {
      conversationId_messageId: { conversationId: conversation.id, messageId },
    },
    select: { id: true },
  });

  if (existingMessage) {
    // Duplicate delivery — nothing to do.
    return;
  }

  await prisma.message.create({
    data: {
      conversationId: conversation.id,
      senderType: 'customer',
      provider: 'openwa',
      contentType,
      contentText: body || null,
      mediaUrl: data.media?.url ?? null,
      messageId,
      status: 'delivered',
      createdAt: data.timestamp
        ? new Date(data.timestamp * 1000)
        : new Date(),
    },
  });

  // ---- post-insert fan-out ----
  const lastMessageText = body || `[${data.type ?? 'message'}]`;

  await prisma.conversation.update({
    where: { id: conversation.id },
    data: {
      unreadCount: { increment: 1 },
      lastMessageText,
      lastMessageAt: new Date(),
      updatedAt: new Date(),
    },
  });

  await reopenClosedConversation(conversation);
  await flagBroadcastReplyIfAny(accountId, contactId);

  if (conversationCreated) {
    await dispatchWebhookEvent(accountId, 'conversation.created', {
      conversation_id: conversation.id,
      contact_id: contactId,
    });
  }

  // Flows consume first; automations + AI only run on non-consumed text.
  const flowResult = await dispatchInboundToFlows({
    accountId,
    userId: ownerUserId,
    contactId,
    conversationId: conversation.id,
    message:
      contentType === 'text'
        ? { kind: 'text', text: body, meta_message_id: messageId }
        : { kind: 'text', text: `[${data.type}]`, meta_message_id: messageId },
    isFirstInboundMessage: wasCreated,
  });

  const flowConsumed = flowResult?.consumed === true;

  if (wasCreated) {
    await runAutomationsForTrigger({
      accountId,
      triggerType: 'new_contact_created',
      contactId,
      context: { message_text: body, conversation_id: conversation.id },
    });
  }

  await runAutomationsForTrigger({
    accountId,
    triggerType: 'new_message_received',
    contactId,
    context: { message_text: body, conversation_id: conversation.id },
  });

  await dispatchInboundToAiReply({
    accountId,
    conversationId: conversation.id,
    contactId,
    configOwnerUserId: ownerUserId,
  });

  await dispatchWebhookEvent(accountId, 'message.received', {
    message_id: messageId,
    conversation_id: conversation.id,
    contact_id: contactId,
    provider: 'openwa',
  });

  void flowConsumed;
}

// ============================================================
// Outbound status updates (ack / failed)
// ============================================================

async function handleAck(
  delivery: OpenWADelivery,
  accountId: string
): Promise<void> {
  const data = delivery.data as { messageId?: string; status?: string };
  const providerMessageId = data.messageId;
  if (!providerMessageId) return;

  const status = data.status;
  if (
    status !== 'delivered' &&
    status !== 'read' &&
    status !== 'failed'
  ) {
    return;
  }

  const updated = await prisma.message.updateMany({
    where: {
      messageId: providerMessageId,
      provider: 'openwa',
      conversation: { accountId },
    },
    data: { status },
  });

  if (updated.count > 0) {
    await dispatchWebhookEvent(accountId, 'message.status_updated', {
      provider_message_id: providerMessageId,
      status,
      provider: 'openwa',
    });
  }
}

// ============================================================
// Session lifecycle
// ============================================================

async function handleSessionState(
  delivery: OpenWADelivery,
  accountId: string,
  openwaSessionId: string
): Promise<void> {
  const data = delivery.data as {
    status?: string;
    phone?: string | null;
    pushName?: string | null;
  };

  const session = await prisma.openWASession.findFirst({
    where: { openwaSessionId, config: { accountId } },
  });
  if (!session) return;

  const status = data.status ?? (delivery.event === 'session.authenticated' ? 'ready' : undefined);
  if (status) {
    await prisma.openWASession.update({
      where: { id: session.id },
      data: {
        status,
        phone: data.phone ?? session.phone,
        pushName: data.pushName ?? session.pushName,
        updatedAt: new Date(),
      },
    });
  }

  // Reflect the best session status on the account config.
  const configStatus =
    delivery.event === 'session.authenticated' || status === 'ready'
      ? 'connected'
      : status === 'disconnected'
        ? 'disconnected'
        : undefined;
  if (configStatus) {
    await prisma.openWAConfig.update({
      where: { accountId },
      data: { status: configStatus, updatedAt: new Date() },
    });
  }
}

// ============================================================
// Broadcast reply tracking (Prisma port of the Meta webhook's
// flagBroadcastReplyIfAny)
// ============================================================

async function flagBroadcastReplyIfAny(
  accountId: string,
  contactId: string
): Promise<void> {
  try {
    const recipient = await prisma.broadcastRecipient.findFirst({
      where: {
        contactId,
        status: { in: ['pending', 'sent', 'delivered', 'read'] },
        broadcast: { accountId },
      },
      orderBy: { createdAt: 'desc' },
      select: { id: true },
    });
    if (!recipient) return;
    await prisma.broadcastRecipient.update({
      where: { id: recipient.id },
      data: { status: 'replied', repliedAt: new Date() },
    });
  } catch (err) {
    console.error('[openwa/webhook] flagBroadcastReplyIfAny failed:', err);
  }
}
