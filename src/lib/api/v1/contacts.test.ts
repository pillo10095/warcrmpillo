import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  prisma: {
    contact: {
      findMany: vi.fn(),
      create: vi.fn(),
      findFirst: vi.fn(),
      updateMany: vi.fn(),
    },
    tag: { findMany: vi.fn(), create: vi.fn() },
    contactTag: {
      findMany: vi.fn(),
      deleteMany: vi.fn(),
      create: vi.fn(),
      createMany: vi.fn(),
    },
    whatsAppConfig: { findUnique: vi.fn() },
    account: { findUnique: vi.fn() },
    $transaction: vi.fn(),
  },
  dispatch: vi.fn(),
}));

vi.mock('@/lib/db/prisma', () => ({ prisma: mocks.prisma }));
vi.mock('@/lib/contacts/tag-events', () => ({
  addContactTagAndDispatch: mocks.dispatch,
}));

import {
  serializeContact,
  findOrCreateContact,
  resolveAuditUserId,
  setContactTags,
  getContactById,
  ContactError,
} from './contacts';

beforeEach(() => {
  mocks.prisma.$transaction.mockImplementation((ops: unknown[]) =>
    Promise.all(ops)
  );
  mocks.dispatch.mockResolvedValue({ added: true, dispatched: false });
  mocks.prisma.contact.findMany.mockResolvedValue([]);
});

describe('serializeContact', () => {
  it('flattens the Prisma contactTags include onto a tags array and nulls missing fields', () => {
    const row = {
      id: 'c1',
      phone: '+14155550123',
      name: 'Jane',
      email: null,
      company: 'Acme',
      avatarUrl: null,
      createdAt: new Date('2026-01-01T00:00:00Z'),
      updatedAt: new Date('2026-01-02T00:00:00Z'),
      contactTags: [
        { tag: { id: 't1', name: 'vip', color: '#fff' } },
        { tag: null }, // orphaned join — dropped
      ],
    };
    expect(serializeContact(row as unknown as Record<string, unknown>)).toEqual({
      id: 'c1',
      phone: '+14155550123',
      name: 'Jane',
      email: null,
      company: 'Acme',
      avatar_url: null,
      tags: [{ id: 't1', name: 'vip', color: '#fff' }],
      created_at: '2026-01-01T00:00:00.000Z',
      updated_at: '2026-01-02T00:00:00.000Z',
    });
  });

  it('tolerates a row with no contactTags key', () => {
    const row = {
      id: 'c2',
      phone: '+1',
      name: null,
      email: null,
      company: null,
      avatarUrl: null,
      createdAt: new Date('2026-01-01T00:00:00Z'),
      updatedAt: new Date('2026-01-01T00:00:00Z'),
    };
    expect(
      serializeContact(row as unknown as Record<string, unknown>).tags
    ).toEqual([]);
  });
});

describe('findOrCreateContact', () => {
  it('rejects a non-E.164 phone with a 400 ContactError before querying', async () => {
    await expect(
      findOrCreateContact(undefined, 'acc', 'user', { phone: 'not-a-number' })
    ).rejects.toMatchObject({ status: 400 });
    await expect(
      findOrCreateContact(undefined, 'acc', 'user', { phone: 'not-a-number' })
    ).rejects.toBeInstanceOf(ContactError);
    expect(mocks.prisma.contact.create).not.toHaveBeenCalled();
  });

  it('creates a contact with the audit user and sanitized phone', async () => {
    mocks.prisma.contact.findMany.mockResolvedValue([]);
    mocks.prisma.contact.create.mockResolvedValue({ id: 'c-new' });

    const result = await findOrCreateContact(undefined, 'acc', 'owner-1', {
      phone: '+1 (415) 555-0123',
      name: 'Jane',
    });

    expect(result).toEqual({ id: 'c-new', created: true });
    expect(mocks.prisma.contact.create).toHaveBeenCalledWith({
      data: {
        accountId: 'acc',
        userId: 'owner-1',
        // sanitizePhoneForMeta stores digits only (Meta format, no '+')
        phone: '14155550123',
        name: 'Jane',
        email: null,
        company: null,
      },
      select: { id: true },
    });
  });

  it('returns the existing fuzzy match without creating', async () => {
    mocks.prisma.contact.findMany.mockResolvedValue([
      { id: 'c1', phone: '14155550123', name: 'Jane' },
    ]);

    const result = await findOrCreateContact(undefined, 'acc', 'owner-1', {
      phone: '+1 (415) 555-0123',
    });

    expect(result).toEqual({ id: 'c1', created: false });
    expect(mocks.prisma.contact.create).not.toHaveBeenCalled();
  });

  it('re-resolves the winner when a concurrent create loses the unique race', async () => {
    mocks.prisma.contact.findMany
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([{ id: 'c-raced', phone: '14155550123', name: null }]);
    mocks.prisma.contact.create.mockRejectedValue(
      Object.assign(new Error('Unique constraint'), { code: 'P2002' })
    );

    const result = await findOrCreateContact(undefined, 'acc', 'owner-1', {
      phone: '+14155550123',
    });

    expect(result).toEqual({ id: 'c-raced', created: false });
  });

  it('maps non-unique create failures to a 500 ContactError', async () => {
    mocks.prisma.contact.findMany.mockResolvedValue([]);
    mocks.prisma.contact.create.mockRejectedValue(new Error('db down'));

    await expect(
      findOrCreateContact(undefined, 'acc', 'owner-1', { phone: '+14155550123' })
    ).rejects.toMatchObject({ status: 500, message: 'Failed to create contact' });
  });
});

describe('resolveAuditUserId', () => {
  it('prefers the WhatsApp config owner', async () => {
    mocks.prisma.whatsAppConfig.findUnique.mockResolvedValue({
      userId: 'config-owner',
    });
    const owner = await resolveAuditUserId(undefined, 'acc');
    expect(owner).toBe('config-owner');
    expect(mocks.prisma.account.findUnique).not.toHaveBeenCalled();
  });

  it('falls back to the account owner when there is no config', async () => {
    mocks.prisma.whatsAppConfig.findUnique.mockResolvedValue(null);
    mocks.prisma.account.findUnique.mockResolvedValue({
      ownerUserId: 'account-owner',
    });
    const owner = await resolveAuditUserId(undefined, 'acc');
    expect(owner).toBe('account-owner');
  });

  it('throws a 500 ContactError when neither owner can be resolved', async () => {
    mocks.prisma.whatsAppConfig.findUnique.mockResolvedValue(null);
    mocks.prisma.account.findUnique.mockResolvedValue(null);
    await expect(resolveAuditUserId(undefined, 'acc')).rejects.toMatchObject({
      status: 500,
    });
  });
});

describe('setContactTags', () => {
  it('diffs the current joins and removes/adds only the changed tags', async () => {
    mocks.prisma.tag.findMany.mockResolvedValue([{ id: 't-vip', name: 'vip' }]);
    mocks.prisma.tag.create.mockResolvedValue({ id: 't-new', name: 'newtag' });
    mocks.prisma.contactTag.findMany.mockResolvedValue([
      { tagId: 't-old' },
      { tagId: 't-vip' },
    ]);
    mocks.prisma.contactTag.deleteMany.mockResolvedValue({ count: 1 });

    await setContactTags(undefined, 'acc', 'owner-1', 'c1', [
      'vip',
      'newtag',
    ]);

    expect(mocks.prisma.contactTag.deleteMany).toHaveBeenCalledWith({
      where: { contactId: 'c1', tagId: { in: ['t-old'] } },
    });
    expect(mocks.dispatch).toHaveBeenCalledTimes(1);
    expect(mocks.dispatch).toHaveBeenCalledWith({
      db: undefined,
      accountId: 'acc',
      contactId: 'c1',
      tagId: 't-new',
    });
  });

  it('clears all tags when passed an empty list', async () => {
    mocks.prisma.tag.findMany.mockResolvedValue([]);
    mocks.prisma.contactTag.findMany.mockResolvedValue([
      { tagId: 't-old' },
    ]);
    mocks.prisma.contactTag.deleteMany.mockResolvedValue({ count: 1 });

    await setContactTags(undefined, 'acc', 'owner-1', 'c1', []);

    expect(mocks.prisma.contactTag.deleteMany).toHaveBeenCalledWith({
      where: { contactId: 'c1', tagId: { in: ['t-old'] } },
    });
    expect(mocks.dispatch).not.toHaveBeenCalled();
  });
});

describe('getContactById', () => {
  it('returns null when the contact is not in the account', async () => {
    mocks.prisma.contact.findFirst.mockResolvedValue(null);
    expect(await getContactById(undefined, 'acc', 'missing')).toBeNull();
  });

  it('serializes a found contact with its tags', async () => {
    mocks.prisma.contact.findFirst.mockResolvedValue({
      id: 'c1',
      phone: '+14155550123',
      name: 'Jane',
      email: null,
      company: null,
      avatarUrl: null,
      createdAt: new Date('2026-01-01T00:00:00Z'),
      updatedAt: new Date('2026-01-01T00:00:00Z'),
      contactTags: [{ tag: { id: 't1', name: 'vip', color: '#fff' } }],
    });

    const contact = await getContactById(undefined, 'acc', 'c1');
    expect(contact?.id).toBe('c1');
    expect(contact?.tags).toEqual([{ id: 't1', name: 'vip', color: '#fff' }]);
    expect(mocks.prisma.contact.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'c1', accountId: 'acc' },
      })
    );
  });
});
