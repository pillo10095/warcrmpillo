import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  requireApiKey: vi.fn(),
  prisma: {
    conversation: { findFirst: vi.fn() },
    message: { findMany: vi.fn() },
  },
}));

vi.mock('@/lib/auth/api-context', () => ({
  requireApiKey: mocks.requireApiKey,
}));
vi.mock('@/lib/db/prisma', () => ({ prisma: mocks.prisma }));

import { GET } from './route';
import { encodeCursor } from '@/lib/api/v1/pagination';

const ctx = {
  accountId: 'acct-1',
  keyId: 'key-1',
  scopes: ['messages:read'],
  createdBy: null,
};

function messageRow(id: string, overrides: Record<string, unknown> = {}) {
  return {
    id,
    conversationId: 'conv-1',
    senderType: 'customer',
    senderId: 'ct-1',
    contentType: 'text',
    contentText: 'hello',
    mediaUrl: null,
    templateName: null,
    messageId: 'wamid-1',
    status: 'sent',
    replyToMessageId: null,
    interactiveReplyId: null,
    interactivePayload: null,
    aiGenerated: false,
    createdAt: new Date('2026-01-01T00:00:00Z'),
    ...overrides,
  };
}

function getRequest(
  url = 'https://crm.example.com/api/v1/conversations/conv-1/messages'
) {
  return new Request(url);
}

function params(id: string) {
  return { params: Promise.resolve({ id }) };
}

beforeEach(() => {
  mocks.requireApiKey.mockReset().mockResolvedValue(ctx);
});

describe('GET /api/v1/conversations/[id]/messages', () => {
  it('gates on account ownership of the conversation first', async () => {
    mocks.prisma.conversation.findFirst.mockResolvedValue(null);

    const response = await GET(getRequest(), params('conv-foreign'));
    const body = await response.json();

    expect(response.status).toBe(404);
    expect(body.error.code).toBe('not_found');
    expect(mocks.prisma.message.findMany).not.toHaveBeenCalled();
  });

  it('lists the conversation messages scoped to the id', async () => {
    mocks.prisma.conversation.findFirst.mockResolvedValue({ id: 'conv-1' });
    mocks.prisma.message.findMany.mockResolvedValue([
      messageRow('m-1'),
      messageRow('m-2', { senderType: 'agent', contentText: 'hi' }),
    ]);

    const response = await GET(getRequest(), params('conv-1'));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.data.map((m: { id: string }) => m.id)).toEqual(['m-1', 'm-2']);
    expect(body.meta.next_cursor).toBeNull();
    expect(mocks.prisma.message.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { conversationId: 'conv-1' },
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      })
    );
  });

  it('serializes direction from sender_type', async () => {
    mocks.prisma.conversation.findFirst.mockResolvedValue({ id: 'conv-1' });
    mocks.prisma.message.findMany.mockResolvedValue([
      messageRow('m-1'),
      messageRow('m-2', { senderType: 'agent' }),
      messageRow('m-3', { senderType: 'bot' }),
    ]);

    const response = await GET(getRequest(), params('conv-1'));
    const body = await response.json();

    expect(body.data.map((m: { direction: string }) => m.direction)).toEqual([
      'inbound',
      'outbound',
      'outbound',
    ]);
  });

  it('maps a keyset cursor onto the message where', async () => {
    mocks.prisma.conversation.findFirst.mockResolvedValue({ id: 'conv-1' });
    mocks.prisma.message.findMany.mockResolvedValue([messageRow('m-2')]);
    const cursorId = 'aaaaaaaa-0000-4000-8000-000000000001';
    const cursor = encodeCursor({
      created_at: '2026-01-01T00:00:00Z',
      id: cursorId,
    });

    await GET(
      getRequest(
        `https://crm.example.com/api/v1/conversations/conv-1/messages?cursor=${encodeURIComponent(cursor)}`
      ),
      params('conv-1')
    );

    expect(mocks.prisma.message.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          conversationId: 'conv-1',
          OR: [
            { createdAt: { lt: new Date('2026-01-01T00:00:00Z') } },
            {
              AND: [
                { createdAt: new Date('2026-01-01T00:00:00Z') },
                { id: { lt: cursorId } },
              ],
            },
          ],
        },
      })
    );
  });

  it('returns a next_cursor when more rows exist than the limit', async () => {
    mocks.prisma.conversation.findFirst.mockResolvedValue({ id: 'conv-1' });
    mocks.prisma.message.findMany.mockResolvedValue([
      messageRow('m-1'),
      messageRow('m-2'),
      messageRow('m-3'),
    ]);

    const response = await GET(
      getRequest(
        'https://crm.example.com/api/v1/conversations/conv-1/messages?limit=2'
      ),
      params('conv-1')
    );
    const body = await response.json();

    expect(body.data).toHaveLength(2);
    expect(body.meta.next_cursor).not.toBeNull();
    expect(mocks.prisma.message.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ take: 3 })
    );
  });

  it('returns a 500 envelope when the message query fails', async () => {
    mocks.prisma.conversation.findFirst.mockResolvedValue({ id: 'conv-1' });
    mocks.prisma.message.findMany.mockRejectedValue(new Error('db down'));

    const response = await GET(getRequest(), params('conv-1'));
    const body = await response.json();

    expect(response.status).toBe(500);
    expect(body.error.code).toBe('internal');
  });
});
