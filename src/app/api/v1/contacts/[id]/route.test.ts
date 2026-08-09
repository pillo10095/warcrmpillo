import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  requireApiKey: vi.fn(),
  prisma: {
    contact: {
      findMany: vi.fn(),
      create: vi.fn(),
      findFirst: vi.fn(),
      updateMany: vi.fn(),
    },
    tag: { findMany: vi.fn(), create: vi.fn() },
    contactTag: { findMany: vi.fn(), deleteMany: vi.fn() },
    whatsAppConfig: { findUnique: vi.fn() },
    account: { findUnique: vi.fn() },
    $transaction: vi.fn(),
  },
  dispatch: vi.fn(),
}));

vi.mock('@/lib/auth/api-context', () => ({
  requireApiKey: mocks.requireApiKey,
}));
vi.mock('@/lib/db/prisma', () => ({ prisma: mocks.prisma }));
vi.mock('@/lib/contacts/tag-events', () => ({
  addContactTagAndDispatch: mocks.dispatch,
}));

import { GET, PATCH } from './route';

const ctx = {
  accountId: 'acct-1',
  keyId: 'key-1',
  scopes: ['contacts:read', 'contacts:write'],
  createdBy: null,
};

function contactRow(id: string, overrides: Record<string, unknown> = {}) {
  return {
    id,
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
    ...overrides,
  };
}

const params = { params: Promise.resolve({ id: 'c1' }) };

function request(method: 'GET' | 'PATCH', body?: unknown) {
  return new Request('https://crm.example.com/api/v1/contacts/c1', {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

beforeEach(() => {
  mocks.requireApiKey.mockReset().mockResolvedValue(ctx);
  mocks.prisma.$transaction.mockImplementation((ops: unknown[]) =>
    Promise.all(ops)
  );
  mocks.dispatch.mockResolvedValue({ added: true, dispatched: false });
});

describe('GET /api/v1/contacts/{id}', () => {
  it('returns the serialized contact for the account', async () => {
    mocks.prisma.contact.findFirst.mockResolvedValue(contactRow('c1'));

    const response = await GET(request('GET'), params);
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.data.id).toBe('c1');
    expect(mocks.prisma.contact.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'c1', accountId: 'acct-1' },
      })
    );
  });

  it('returns 404 not_found when the contact is outside the account', async () => {
    mocks.prisma.contact.findFirst.mockResolvedValue(null);

    const response = await GET(request('GET'), params);
    const body = await response.json();

    expect(response.status).toBe(404);
    expect(body.error).toEqual({
      code: 'not_found',
      message: 'Contact not found',
    });
  });
});

describe('PATCH /api/v1/contacts/{id}', () => {
  it('updates only the scalar fields present in the body', async () => {
    mocks.prisma.contact.findFirst.mockResolvedValue(contactRow('c1'));

    const response = await PATCH(
      request('PATCH', { name: 'Renamed', company: 'Acme' }),
      params
    );

    expect(response.status).toBe(200);
    expect(mocks.prisma.contact.updateMany).toHaveBeenCalledWith({
      where: { id: 'c1', accountId: 'acct-1' },
      data: { name: 'Renamed', company: 'Acme' },
    });
  });

  it('clears a field when null is provided', async () => {
    mocks.prisma.contact.findFirst.mockResolvedValue(contactRow('c1'));

    const response = await PATCH(request('PATCH', { email: null }), params);

    expect(response.status).toBe(200);
    expect(mocks.prisma.contact.updateMany).toHaveBeenCalledWith({
      where: { id: 'c1', accountId: 'acct-1' },
      data: { email: null },
    });
  });

  it('returns 404 before mutating when the contact is not in the account', async () => {
    mocks.prisma.contact.findFirst.mockResolvedValue(null);

    const response = await PATCH(request('PATCH', { name: 'X' }), params);

    expect(response.status).toBe(404);
    expect(mocks.prisma.contact.updateMany).not.toHaveBeenCalled();
  });

  it('rejects a non-string/non-null field value with 400', async () => {
    mocks.prisma.contact.findFirst.mockResolvedValue(contactRow('c1'));

    const response = await PATCH(request('PATCH', { email: 123 }), params);
    const body = await response.json();

    expect(response.status).toBe(400);
    expect(body.error).toEqual({
      code: 'bad_request',
      message: "'email' must be a string or null",
    });
    expect(mocks.prisma.contact.updateMany).not.toHaveBeenCalled();
  });

  it('replaces tags when tags is provided', async () => {
    mocks.prisma.contact.findFirst.mockResolvedValue(
      contactRow('c1', {
        contactTags: [{ tag: { id: 't-vip', name: 'vip', color: '#3b82f6' } }],
      })
    );
    mocks.prisma.whatsAppConfig.findUnique.mockResolvedValue(null);
    mocks.prisma.account.findUnique.mockResolvedValue({
      ownerUserId: 'owner-1',
    });
    mocks.prisma.tag.findMany.mockResolvedValue([
      { id: 't-vip', name: 'vip' },
    ]);
    mocks.prisma.contactTag.findMany.mockResolvedValue([
      { tagId: 't-old' },
      { tagId: 't-vip' },
    ]);
    mocks.prisma.contactTag.deleteMany.mockResolvedValue({ count: 1 });

    const response = await PATCH(request('PATCH', { tags: ['vip'] }), params);

    expect(response.status).toBe(200);
    expect(mocks.prisma.contactTag.deleteMany).toHaveBeenCalledWith({
      where: { contactId: 'c1', tagId: { in: ['t-old'] } },
    });
  });
});
