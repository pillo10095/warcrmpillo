import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  requireApiKey: vi.fn(),
  prisma: {
    conversation: { findMany: vi.fn() },
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
  scopes: ['conversations:read'],
  createdBy: null,
};

function conversationRow(id: string, overrides: Record<string, unknown> = {}) {
  return {
    id,
    accountId: 'acct-1',
    userId: 'owner-1',
    contactId: 'ct-1',
    status: 'open',
    assignedAgentId: null,
    lastMessageText: null,
    lastMessageAt: null,
    unreadCount: 0,
    createdAt: new Date('2026-01-01T00:00:00Z'),
    updatedAt: new Date('2026-01-01T00:00:00Z'),
    contact: {
      id: 'ct-1',
      accountId: 'acct-1',
      userId: 'owner-1',
      phone: '+14155550123',
      phoneNormalized: '14155550123',
      name: 'Jane',
      email: null,
      company: null,
      avatarUrl: null,
      createdAt: new Date('2026-01-01T00:00:00Z'),
      updatedAt: new Date('2026-01-01T00:00:00Z'),
      contactTags: [],
    },
    ...overrides,
  };
}

function getRequest(url = 'https://crm.example.com/api/v1/conversations') {
  return new Request(url);
}

beforeEach(() => {
  mocks.requireApiKey.mockReset().mockResolvedValue(ctx);
});

describe('GET /api/v1/conversations', () => {
  it('lists conversations scoped to the account', async () => {
    mocks.prisma.conversation.findMany.mockResolvedValue([
      conversationRow('conv-1'),
      conversationRow('conv-2'),
    ]);

    const response = await GET(getRequest());
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.data.map((c: { id: string }) => c.id)).toEqual([
      'conv-1',
      'conv-2',
    ]);
    expect(body.meta.next_cursor).toBeNull();
    expect(mocks.prisma.conversation.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { accountId: 'acct-1' },
        include: expect.objectContaining({ contact: expect.any(Object) }),
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      })
    );
  });

  it('filters by status and contact_id', async () => {
    mocks.prisma.conversation.findMany.mockResolvedValue([
      conversationRow('conv-1'),
    ]);

    await GET(
      getRequest(
        'https://crm.example.com/api/v1/conversations?status=pending&contact_id=ct-9'
      )
    );

    expect(mocks.prisma.conversation.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          accountId: 'acct-1',
          AND: [{ status: 'pending' }, { contactId: 'ct-9' }],
        },
      })
    );
  });

  it('maps a keyset cursor onto the Prisma where', async () => {
    mocks.prisma.conversation.findMany.mockResolvedValue([
      conversationRow('conv-2'),
    ]);
    // decodeCursor only trusts server-issued cursors: the id must be a
    // UUID (see pagination.ts), otherwise the cursor is treated as
    // absent and the route would query from the first page.
    const cursorId = 'aaaaaaaa-0000-4000-8000-000000000001';
    const cursor = encodeCursor({
      created_at: '2026-01-01T00:00:00Z',
      id: cursorId,
    });

    await GET(
      getRequest(
        `https://crm.example.com/api/v1/conversations?cursor=${encodeURIComponent(cursor)}`
      )
    );

    expect(mocks.prisma.conversation.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          accountId: 'acct-1',
          AND: [
            {
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
          ],
        },
      })
    );
  });

  it('returns a next_cursor when more rows exist than the limit', async () => {
    mocks.prisma.conversation.findMany.mockResolvedValue([
      conversationRow('conv-1'),
      conversationRow('conv-2'),
      conversationRow('conv-3'),
    ]);

    const response = await GET(
      getRequest('https://crm.example.com/api/v1/conversations?limit=2')
    );
    const body = await response.json();

    expect(body.data).toHaveLength(2);
    expect(body.meta.next_cursor).not.toBeNull();
    expect(mocks.prisma.conversation.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ take: 3 })
    );
  });

  it('embeds the contact with its tags', async () => {
    mocks.prisma.conversation.findMany.mockResolvedValue([
      conversationRow('conv-1', {
        contact: {
          id: 'ct-1',
          accountId: 'acct-1',
          userId: 'owner-1',
          phone: '+14155550123',
          phoneNormalized: '14155550123',
          name: 'Jane',
          email: null,
          company: null,
          avatarUrl: null,
          createdAt: new Date('2026-01-01T00:00:00Z'),
          updatedAt: new Date('2026-01-01T00:00:00Z'),
          contactTags: [
            {
              id: 'cjt-1',
              contactId: 'ct-1',
              tagId: 't-1',
              createdAt: new Date('2026-01-01T00:00:00Z'),
              tag: {
                id: 't-1',
                accountId: 'acct-1',
                userId: 'owner-1',
                name: 'vip',
                color: '#3b82f6',
                createdAt: new Date('2026-01-01T00:00:00Z'),
              },
            },
          ],
        },
      }),
    ]);

    const response = await GET(getRequest());
    const body = await response.json();

    expect(body.data[0].contact).toEqual(
      expect.objectContaining({
        id: 'ct-1',
        phone: '+14155550123',
        name: 'Jane',
      })
    );
    expect(body.data[0].contact.tags).toEqual([
      { id: 't-1', name: 'vip', color: '#3b82f6' },
    ]);
  });

  it('returns an empty list with a null cursor for no rows', async () => {
    mocks.prisma.conversation.findMany.mockResolvedValue([]);

    const response = await GET(getRequest());
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.data).toEqual([]);
    expect(body.meta.next_cursor).toBeNull();
  });

  it('returns a 500 envelope when the query fails', async () => {
    mocks.prisma.conversation.findMany.mockRejectedValue(
      new Error('db down')
    );

    const response = await GET(getRequest());
    const body = await response.json();

    expect(response.status).toBe(500);
    expect(body.error.code).toBe('internal');
  });
});
