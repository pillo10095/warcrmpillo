import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  requireApiKey: vi.fn(),
  prisma: {
    conversation: { findFirst: vi.fn() },
  },
}));

vi.mock('@/lib/auth/api-context', () => ({
  requireApiKey: mocks.requireApiKey,
}));
vi.mock('@/lib/db/prisma', () => ({ prisma: mocks.prisma }));

import { GET } from './route';

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

function getRequest(url = 'https://crm.example.com/api/v1/conversations/conv-1') {
  return new Request(url);
}

function params(id: string) {
  return { params: Promise.resolve({ id }) };
}

beforeEach(() => {
  mocks.requireApiKey.mockReset().mockResolvedValue(ctx);
});

describe('GET /api/v1/conversations/[id]', () => {
  it('reads one conversation scoped to the account', async () => {
    mocks.prisma.conversation.findFirst.mockResolvedValue(
      conversationRow('conv-1')
    );

    const response = await GET(getRequest(), params('conv-1'));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.data.id).toBe('conv-1');
    expect(mocks.prisma.conversation.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'conv-1', accountId: 'acct-1' },
      })
    );
  });

  it('returns 404 for an unknown or foreign id', async () => {
    mocks.prisma.conversation.findFirst.mockResolvedValue(null);

    const response = await GET(getRequest(), params('conv-foreign'));
    const body = await response.json();

    expect(response.status).toBe(404);
    expect(body.error.code).toBe('not_found');
    expect(mocks.prisma.conversation.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'conv-foreign', accountId: 'acct-1' },
      })
    );
  });

  it('returns a 500 envelope when the query fails', async () => {
    mocks.prisma.conversation.findFirst.mockRejectedValue(
      new Error('db down')
    );

    const response = await GET(getRequest(), params('conv-1'));
    const body = await response.json();

    expect(response.status).toBe(500);
    expect(body.error.code).toBe('internal');
  });
});
