import { describe, it, expect, vi, beforeEach } from 'vitest';

const h = vi.hoisted(() => ({
  prisma: {
    openWASession: { findFirst: vi.fn(), update: vi.fn() },
    openWAConfig: { update: vi.fn() },
    contact: { create: vi.fn(), update: vi.fn() },
    conversation: { findFirst: vi.fn(), create: vi.fn(), update: vi.fn() },
    message: { findUnique: vi.fn(), create: vi.fn(), updateMany: vi.fn() },
    broadcastRecipient: { findFirst: vi.fn(), update: vi.fn() },
  },
  verifyOpenWAWebhookSignature: vi.fn(),
  findExistingContact: vi.fn(),
  isUniqueViolation: vi.fn(),
  reopenClosedConversation: vi.fn(),
  dispatchInboundToFlows: vi.fn(),
  runAutomationsForTrigger: vi.fn(),
  dispatchInboundToAiReply: vi.fn(),
  dispatchWebhookEvent: vi.fn(),
  state: {
    afterCallbacks: [] as (() => Promise<void> | void)[],
  },
}));

vi.mock('next/server', () => ({
  after: (cb: () => Promise<void> | void) => {
    h.state.afterCallbacks.push(cb);
  },
  NextResponse: {
    json: (body: unknown, init?: { status?: number }) => ({ body, init }),
  },
}));

vi.mock('@/lib/db/prisma', () => ({ prisma: h.prisma }));
vi.mock('@/lib/whatsapp/openwa-signature', () => ({
  verifyOpenWAWebhookSignature: h.verifyOpenWAWebhookSignature,
}));
vi.mock('@/lib/whatsapp/phone-utils', () => ({
  normalizePhone: (p: string) => p?.replace(/\D/g, ''),
}));
vi.mock('@/lib/contacts/duplicate-lookup', () => ({
  findExistingContact: h.findExistingContact,
}));
vi.mock('@/lib/contacts/dedupe', () => ({
  isUniqueViolation: h.isUniqueViolation,
}));
vi.mock('@/lib/conversations/reopen', () => ({
  reopenClosedConversation: h.reopenClosedConversation,
}));
vi.mock('@/lib/flows/engine', () => ({
  dispatchInboundToFlows: h.dispatchInboundToFlows,
}));
vi.mock('@/lib/automations/engine', () => ({
  runAutomationsForTrigger: h.runAutomationsForTrigger,
}));
vi.mock('@/lib/ai/auto-reply', () => ({
  dispatchInboundToAiReply: h.dispatchInboundToAiReply,
}));
vi.mock('@/lib/webhooks/deliver', () => ({
  dispatchWebhookEvent: h.dispatchWebhookEvent,
}));

import { POST } from './route';

type MockedResponse = { body: unknown; init?: { status?: number } };

function resStatus(res: unknown): number | undefined {
  return (res as MockedResponse).init?.status;
}

const ACCOUNT_ID = 'acct-1';
const OWNER_USER_ID = 'owner-1';

function sessionRow() {
  return {
    id: 'sess-row-1',
    openwaSessionId: 'sess-123',
    configId: 'cfg-1',
    name: 'line-1',
    status: 'ready',
    config: {
      accountId: ACCOUNT_ID,
      apiUrl: 'http://localhost:2785/api',
      account: { ownerUserId: OWNER_USER_ID },
    },
  };
}

function inboundRequest(event: string, data: Record<string, unknown> = {}) {
  const body = {
    event,
    timestamp: '1700000000',
    sessionId: 'sess-123',
    idempotencyKey: 'k-1',
    deliveryId: 'd-1',
    data,
  };
  return {
    text: async () => JSON.stringify(body),
    headers: { get: () => 'hmac=stub' },
  } as unknown as Request;
}

async function runWebhook(request: Request) {
  const res = await POST(request);
  for (const cb of h.state.afterCallbacks) await cb();
  return res;
}

beforeEach(() => {
  vi.clearAllMocks();
  h.state.afterCallbacks = [];
  h.verifyOpenWAWebhookSignature.mockReturnValue(true);
  h.findExistingContact.mockResolvedValue(null);
  h.isUniqueViolation.mockReturnValue(false);
  h.reopenClosedConversation.mockResolvedValue(undefined);
  h.dispatchInboundToFlows.mockResolvedValue({ consumed: false });
  h.runAutomationsForTrigger.mockResolvedValue(undefined);
  h.dispatchInboundToAiReply.mockResolvedValue(undefined);
  h.dispatchWebhookEvent.mockResolvedValue(undefined);

  h.prisma.openWASession.findFirst.mockResolvedValue(sessionRow());
  h.prisma.contact.create.mockResolvedValue({
    id: 'contact-1',
    name: 'Ada',
    phone: '15551230000',
  });
  h.prisma.conversation.findFirst.mockResolvedValue(null);
  h.prisma.conversation.create.mockResolvedValue({
    id: 'conv-1',
    accountId: ACCOUNT_ID,
    userId: OWNER_USER_ID,
    contactId: 'contact-1',
    provider: 'openwa',
  });
  h.prisma.message.findUnique.mockResolvedValue(null);
  h.prisma.message.create.mockResolvedValue({ id: 'msg-1' });
  h.prisma.conversation.update.mockResolvedValue({});
  h.prisma.broadcastRecipient.findFirst.mockResolvedValue(null);
  h.prisma.message.updateMany.mockResolvedValue({ count: 1 });
  h.prisma.openWASession.update.mockResolvedValue({});
  h.prisma.openWAConfig.update.mockResolvedValue({});
});

describe('POST /api/openwa/webhook â€” handshake', () => {
  it('rejects an invalid signature with 401', async () => {
    h.verifyOpenWAWebhookSignature.mockReturnValue(false);
    const res = await POST(inboundRequest('message.received'));
    expect(resStatus(res)).toBe(401);
  });

  it('rejects a malformed body with 400', async () => {
    const request = {
      text: async () => 'not json',
      headers: { get: () => 'x' },
    } as unknown as Request;
    const res = await POST(request);
    expect(resStatus(res)).toBe(400);
  });

  it('rejects a body without sessionId with 400', async () => {
    const body = { event: 'message.received', timestamp: '1' };
    const request = {
      text: async () => JSON.stringify(body),
      headers: { get: () => 'x' },
    } as unknown as Request;
    const res = await POST(request);
    expect(resStatus(res)).toBe(400);
  });

  it('returns 404 for an unknown session', async () => {
    h.prisma.openWASession.findFirst.mockResolvedValue(null);
    const res = await POST(inboundRequest('message.received'));
    expect(resStatus(res)).toBe(404);
  });

  it('acks valid deliveries with 200 and drains after()', async () => {
    const res = await runWebhook(inboundRequest('message.received', {
      id: 'm-1',
      from: '15551230000',
      body: 'hello',
    }));
    expect(res).toEqual({ body: { status: 'received' } });
    expect(h.prisma.message.create).toHaveBeenCalled();
  });
});

describe('POST /api/openwa/webhook â€” inbound message', () => {
  it('finds or creates contact + conversation scoped to openwa and persists', async () => {
    await runWebhook(inboundRequest('message.received', {
      id: 'm-1',
      from: '+15551230000',
      body: 'hello',
      type: 'text',
      timestamp: 1700000000,
    }));

    expect(h.prisma.contact.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ accountId: ACCOUNT_ID, phone: '15551230000' }),
      select: { id: true, name: true, phone: true },
    });
    expect(h.prisma.conversation.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        accountId: ACCOUNT_ID,
        contactId: 'contact-1',
        provider: 'openwa',
      }),
    });
    expect(h.prisma.conversation.findFirst).toHaveBeenCalledWith({
      where: { accountId: ACCOUNT_ID, contactId: 'contact-1', provider: 'openwa' },
      orderBy: { createdAt: 'asc' },
    });
    expect(h.prisma.message.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        conversationId: 'conv-1',
        senderType: 'customer',
        provider: 'openwa',
        contentType: 'text',
        contentText: 'hello',
        messageId: 'm-1',
        status: 'delivered',
      }),
    });
  });

  it('bumps unread and fans out to flows/automations/AI/webhook', async () => {
    await runWebhook(inboundRequest('message.received', {
      id: 'm-1',
      from: '15551230000',
      body: 'hello',
      type: 'text',
    }));

    expect(h.prisma.conversation.update).toHaveBeenCalledWith({
      where: { id: 'conv-1' },
      data: expect.objectContaining({
        unreadCount: { increment: 1 },
        lastMessageText: 'hello',
      }),
    });
    expect(h.dispatchInboundToFlows).toHaveBeenCalledTimes(1);
    expect(h.runAutomationsForTrigger).toHaveBeenCalledTimes(2);
    expect(h.dispatchInboundToAiReply).toHaveBeenCalledTimes(1);
    expect(h.dispatchWebhookEvent).toHaveBeenCalledTimes(2);
  });

  it('skips duplicate deliveries (no unread bump, no fan-out)', async () => {
    h.prisma.message.findUnique.mockResolvedValue({ id: 'msg-dup' });

    await runWebhook(inboundRequest('message.received', {
      id: 'm-1',
      from: '15551230000',
      body: 'hello',
    }));

    expect(h.prisma.message.create).not.toHaveBeenCalled();
    expect(h.prisma.conversation.update).not.toHaveBeenCalled();
    expect(h.dispatchInboundToFlows).not.toHaveBeenCalled();
    expect(h.dispatchWebhookEvent).not.toHaveBeenCalled();
  });

  it('ignores group messages', async () => {
    await runWebhook(inboundRequest('message.received', {
      id: 'm-1',
      from: '15551230000',
      isGroup: true,
    }));

    expect(h.prisma.message.create).not.toHaveBeenCalled();
  });

  it('flags a broadcast reply when a recipient is pending', async () => {
    h.prisma.broadcastRecipient.findFirst.mockResolvedValue({ id: 'rec-1' });

    await runWebhook(inboundRequest('message.received', {
      id: 'm-1',
      from: '15551230000',
      body: 'hi',
    }));

    expect(h.prisma.broadcastRecipient.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          contactId: 'contact-1',
          broadcast: { accountId: ACCOUNT_ID },
        }),
      })
    );
    expect(h.prisma.broadcastRecipient.update).toHaveBeenCalledWith({
      where: { id: 'rec-1' },
      data: expect.objectContaining({ status: 'replied' }),
    });
  });
});

describe('POST /api/openwa/webhook â€” ack / failed', () => {
  it('updates the outbound message status and dispatches a status event', async () => {
    await runWebhook(inboundRequest('message.ack', {
      messageId: 'out-1',
      status: 'delivered',
    }));

    expect(h.prisma.message.updateMany).toHaveBeenCalledWith({
      where: {
        messageId: 'out-1',
        provider: 'openwa',
        conversation: { accountId: ACCOUNT_ID },
      },
      data: { status: 'delivered' },
    });
    expect(h.dispatchWebhookEvent).toHaveBeenCalledWith(
      ACCOUNT_ID,
      'message.status_updated',
      expect.objectContaining({ provider_message_id: 'out-1' })
    );
  });

  it('ignores unknown ack statuses', async () => {
    await runWebhook(inboundRequest('message.ack', {
      messageId: 'out-1',
      status: 'weird',
    }));

    expect(h.prisma.message.updateMany).not.toHaveBeenCalled();
  });
});

describe('POST /api/openwa/webhook â€” session lifecycle', () => {
  it('marks the session ready and the config connected on authenticated', async () => {
    await runWebhook(inboundRequest('session.authenticated', {
      phone: '15551230000',
      pushName: 'Line A',
    }));

    expect(h.prisma.openWASession.update).toHaveBeenCalledWith({
      where: { id: 'sess-row-1' },
      data: expect.objectContaining({
        status: 'ready',
        phone: '15551230000',
        pushName: 'Line A',
      }),
    });
    expect(h.prisma.openWAConfig.update).toHaveBeenCalledWith({
      where: { accountId: ACCOUNT_ID },
      data: expect.objectContaining({ status: 'connected' }),
    });
  });

  it('marks the config disconnected on session.status disconnected', async () => {
    await runWebhook(inboundRequest('session.status', { status: 'disconnected' }));

    expect(h.prisma.openWAConfig.update).toHaveBeenCalledWith({
      where: { accountId: ACCOUNT_ID },
      data: expect.objectContaining({ status: 'disconnected' }),
    });
  });
});
