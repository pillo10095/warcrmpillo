import { beforeEach, describe, expect, it, vi } from 'vitest';

const mockDb = vi.hoisted(() => ({
  tag: { findMany: vi.fn(), create: vi.fn() },
  contactTag: { createMany: vi.fn() },
  $transaction: vi.fn(),
}));

vi.mock('@/lib/db/prisma', () => ({ prisma: mockDb }));

import {
  assignImportedContactTags,
  resolveImportTagIds,
} from './resolve-import-tags';

beforeEach(() => {
  mockDb.tag.findMany.mockReset();
  mockDb.tag.create.mockReset();
  mockDb.contactTag.createMany.mockReset();
  mockDb.$transaction.mockReset();
  mockDb.$transaction.mockImplementation((ops: unknown[]) => Promise.all(ops));
});

describe('resolveImportTagIds', () => {
  it('matches existing account tags case-insensitively', async () => {
    mockDb.tag.findMany.mockResolvedValue([
      { id: 't1', name: 'VIP' },
      { id: 't2', name: 'Lead' },
    ]);

    const { tagIdByKey, skippedNames } = await resolveImportTagIds(undefined, {
      accountId: 'acct',
      userId: 'user',
      tagNames: ['vip', '  lead ', 'vip'],
      canCreateTags: true,
    });

    expect(tagIdByKey.get('vip')).toBe('t1');
    expect(tagIdByKey.get('lead')).toBe('t2');
    expect(skippedNames).toEqual([]);
    expect(mockDb.tag.findMany).toHaveBeenCalledWith({
      where: { accountId: 'acct' },
      select: { id: true, name: true },
    });
  });

  it('creates missing tags when allowed, attributed to the audit user', async () => {
    mockDb.tag.findMany.mockResolvedValue([{ id: 't1', name: 'vip' }]);
    mockDb.tag.create.mockResolvedValue({ id: 't-new', name: 'newtag' });

    const { tagIdByKey } = await resolveImportTagIds(undefined, {
      accountId: 'acct',
      userId: 'user',
      tagNames: ['vip', 'newtag'],
      canCreateTags: true,
      defaultColor: '#123456',
    });

    expect(tagIdByKey.get('newtag')).toBe('t-new');
    expect(mockDb.tag.create).toHaveBeenCalledWith({
      data: {
        accountId: 'acct',
        userId: 'user',
        name: 'newtag',
        color: '#123456',
      },
      select: { id: true, name: true },
    });
  });

  it('reports missing names in skippedNames instead of creating when not allowed', async () => {
    mockDb.tag.findMany.mockResolvedValue([{ id: 't1', name: 'vip' }]);

    const { tagIdByKey, skippedNames } = await resolveImportTagIds(undefined, {
      accountId: 'acct',
      userId: 'user',
      tagNames: ['vip', 'nope'],
      canCreateTags: false,
    });

    expect(skippedNames).toEqual(['nope']);
    expect(tagIdByKey.get('vip')).toBe('t1');
    expect(mockDb.tag.create).not.toHaveBeenCalled();
  });

  it('short-circuits on empty tag lists without querying', async () => {
    const { tagIdByKey, skippedNames } = await resolveImportTagIds(undefined, {
      accountId: 'acct',
      userId: 'user',
      tagNames: ['   ', ''],
      canCreateTags: true,
    });
    expect(tagIdByKey.size).toBe(0);
    expect(skippedNames).toEqual([]);
    expect(mockDb.tag.findMany).not.toHaveBeenCalled();
  });
});

describe('assignImportedContactTags', () => {
  it('inserts deduped contact-tag pairs via createMany and returns the requested count', async () => {
    mockDb.contactTag.createMany.mockResolvedValue({ count: 2 });

    const tagIdByKey = new Map([
      ['vip', 't1'],
      ['lead', 't2'],
    ]);
    const assigned = await assignImportedContactTags(
      undefined,
      [
        { contactId: 'c1', tagNames: ['vip', 'lead'] },
        { contactId: 'c2', tagNames: ['vip'] },
      ],
      tagIdByKey
    );

    expect(assigned).toBe(3);
    expect(mockDb.contactTag.createMany).toHaveBeenCalledWith({
      data: [
        { contactId: 'c1', tagId: 't1' },
        { contactId: 'c1', tagId: 't2' },
        { contactId: 'c2', tagId: 't1' },
      ],
      skipDuplicates: true,
    });
  });

  it('drops unknown tag names and duplicate tags for a contact', async () => {
    const tagIdByKey = new Map([['vip', 't1']]);
    const assigned = await assignImportedContactTags(
      undefined,
      [{ contactId: 'c1', tagNames: ['vip', 'vip', 'unknown'] }],
      tagIdByKey
    );

    expect(assigned).toBe(1);
    expect(mockDb.contactTag.createMany).toHaveBeenCalledWith({
      data: [{ contactId: 'c1', tagId: 't1' }],
      skipDuplicates: true,
    });
  });

  it('returns 0 and never queries when there is nothing to assign', async () => {
    const assigned = await assignImportedContactTags(
      undefined,
      [{ contactId: 'c1', tagNames: ['unknown'] }],
      new Map()
    );
    expect(assigned).toBe(0);
    expect(mockDb.contactTag.createMany).not.toHaveBeenCalled();
  });
});
