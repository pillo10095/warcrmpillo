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

import { GET, POST } from './route';
import { encodeCursor } from '@/lib/api/v1/pagination';

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

function getRequest(url = 'https://crm.example.com/api/v1/contacts') {
  return new Request(url);
}

function postRequest(body: unknown) {
  return new Request('https://crm.example.com/api/v1/contacts', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  mocks.requireApiKey.mockReset().mockResolvedValue(ctx);
  mocks.prisma.$transaction.mockImplementation((ops: unknown[]) =>
    Promise.all(ops)
  );
  mocks.dispatch.mockResolvedValue({ added: true, dispatched: false });
});

describe('GET /api/v1/contacts', () => {
  it('lists contacts scoped to the account', async () => {
    mocks.prisma.contact.findMany.mockResolvedValue([
      contactRow('c1'),
      contactRow('c2'),
    ]);

    const response = await GET(getRequest());
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.data.map((c: { id: string }) => c.id)).toEqual(['c1', 'c2']);
    expect(body.meta.next_cursor).toBeNull();
    expect(mocks.prisma.contact.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { accountId: 'acct-1' },
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      })
    );
  });

  it('filters by tag through the contact_tags join', async () => {
    mocks.prisma.contact.findMany.mockResolvedValue([contactRow('c1')]);

    await GET(getRequest('https://crm.example.com/api/v1/contacts?tag=t1'));

    expect(mocks.prisma.contact.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { accountId: 'acct-1', contactTags: { some: { tagId: 't1' } } },
      })
    );
  });

  it('searches name/phone through a sanitized OR', async () => {
    mocks.prisma.contact.findMany.mockResolvedValue([contactRow('c1')]);

    await GET(
      getRequest('https://crm.example.com/api/v1/contacts?search=Jane$%')
    );

    expect(mocks.prisma.contact.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          accountId: 'acct-1',
          AND: [
            {
              OR: [{ name: { contains: 'Jane' } }, { phone: { contains: 'Jane' } }],
            },
          ],
        },
      })
    );
  });

  it('maps a keyset cursor onto the Prisma where', async () => {
    mocks.prisma.contact.findMany.mockResolvedValue([contactRow('c2')]);
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
        `https://crm.example.com/api/v1/contacts?cursor=${encodeURIComponent(cursor)}`
      )
    );

    expect(mocks.prisma.contact.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          accountId: 'acct-1',
          AND: [
            {
              OR: [
                { createdAt: { lt: new Date('2026-01-01T00:00:00Z') } },
                { AND: [{ createdAt: new Date('2026-01-01T00:00:00Z') }, { id: { lt: cursorId } }] },
              ],
            },
          ],
        },
      })
    );
  });

  it('returns a next_cursor when more rows exist than the limit', async () => {
    mocks.prisma.contact.findMany.mockResolvedValue([
      contactRow('c1'),
      contactRow('c2'),
      contactRow('c3'),
    ]);

    const response = await GET(
      getRequest('https://crm.example.com/api/v1/contacts?limit=2')
    );
    const body = await response.json();

    expect(body.data).toHaveLength(2);
    expect(body.meta.next_cursor).not.toBeNull();
    expect(mocks.prisma.contact.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ take: 3 })
    );
  });
});

describe('POST /api/v1/contacts', () => {
  it('creates a contact with the account-owner fallback audit user and returns 201', async () => {
    mocks.prisma.whatsAppConfig.findUnique.mockResolvedValue(null);
    mocks.prisma.account.findUnique.mockResolvedValue({
      ownerUserId: 'owner-1',
    });
    mocks.prisma.contact.findMany.mockResolvedValue([]);
    mocks.prisma.contact.create.mockResolvedValue({ id: 'c-new' });
    mocks.prisma.contact.findFirst.mockResolvedValue(contactRow('c-new'));

    const response = await POST(
      postRequest({ phone: '+1 (415) 555-0123', name: 'Jane' })
    );
    const body = await response.json();

    expect(response.status).toBe(201);
    expect(body.data.id).toBe('c-new');
    expect(mocks.prisma.whatsAppConfig.findUnique).toHaveBeenCalledWith({
      where: { accountId: 'acct-1' },
      select: { userId: true },
    });
    expect(mocks.prisma.contact.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          accountId: 'acct-1',
          userId: 'owner-1',
          // sanitizePhoneForMeta stores digits only (Meta format, no '+')
          phone: '14155550123',
        }),
      })
    );
  });

  it('returns 200 with created:false when an existing match is found', async () => {
    mocks.prisma.whatsAppConfig.findUnique.mockResolvedValue({
      userId: 'owner-1',
    });
    mocks.prisma.contact.findMany.mockResolvedValue([
      { id: 'c1', phone: '+14155550123', name: 'Jane' },
    ]);
    mocks.prisma.contact.findFirst.mockResolvedValue(contactRow('c1'));

    const response = await POST(postRequest({ phone: '+14155550123' }));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.data.id).toBe('c1');
    expect(mocks.prisma.contact.create).not.toHaveBeenCalled();
  });

  it('rejects an invalid phone with a 400 bad_request envelope', async () => {
    mocks.prisma.whatsAppConfig.findUnique.mockResolvedValue({
      userId: 'owner-1',
    });

    const response = await POST(postRequest({ phone: 'not-a-number' }));
    const body = await response.json();

    expect(response.status).toBe(400);
    expect(body.error.code).toBe('bad_request');
  });

  it('applies tags through setContactTags when tags are provided', async () => {
    mocks.prisma.whatsAppConfig.findUnique.mockResolvedValue(null);
    mocks.prisma.account.findUnique.mockResolvedValue({
      ownerUserId: 'owner-1',
    });
    mocks.prisma.contact.findMany.mockResolvedValue([]);
    mocks.prisma.contact.create.mockResolvedValue({ id: 'c-new' });
    mocks.prisma.tag.findMany.mockResolvedValue([]);
    mocks.prisma.tag.create.mockResolvedValue({ id: 't-vip', name: 'vip' });
    mocks.prisma.contactTag.findMany.mockResolvedValue([]);
    mocks.prisma.contact.findFirst.mockResolvedValue(
      contactRow('c-new', {
        contactTags: [{ tag: { id: 't-vip', name: 'vip', color: '#3b82f6' } }],
      })
    );

    const response = await POST(
      postRequest({ phone: '+14155550123', tags: ['vip'] })
    );
    const body = await response.json();

    expect(response.status).toBe(201);
    expect(body.data.tags).toEqual([
      { id: 't-vip', name: 'vip', color: '#3b82f6' },
    ]);
    expect(mocks.dispatch).toHaveBeenCalledWith({
      db: undefined,
      accountId: 'acct-1',
      contactId: 'c-new',
      tagId: 't-vip',
    });
  });

  it('rejects a non-object body with 400', async () => {
    mocks.prisma.whatsAppConfig.findUnique.mockResolvedValue({
      userId: 'owner-1',
    });

    const response = await POST(
      new Request('https://crm.example.com/api/v1/contacts', {
        method: 'POST',
        body: 'not-json',
      })
    );
    const body = await response.json();

    expect(response.status).toBe(400);
    expect(body.error.code).toBe('bad_request');
  });
});
