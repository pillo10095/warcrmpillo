import { beforeEach, describe, expect, it, vi } from 'vitest';

const mockDb = vi.hoisted(() => ({
  contact: { findFirst: vi.fn() },
  tag: { findFirst: vi.fn() },
  contactTag: { create: vi.fn(), deleteMany: vi.fn() },
}));

vi.mock('@/lib/db/prisma', () => ({ prisma: mockDb }));

import { addContactTagIfAbsent, removeContactTag } from './tag-write';

const input = {
  accountId: 'account-1',
  contactId: 'contact-1',
  tagId: 'tag-1',
};

beforeEach(() => {
  mockDb.contact.findFirst.mockReset();
  mockDb.tag.findFirst.mockReset();
  mockDb.contactTag.create.mockReset();
  mockDb.contactTag.deleteMany.mockReset();
  mockDb.contact.findFirst.mockResolvedValue({ id: 'contact-1' });
  mockDb.tag.findFirst.mockResolvedValue({ id: 'tag-1' });
});

describe('addContactTagIfAbsent', () => {
  it('returns true only when the join row was inserted', async () => {
    mockDb.contactTag.create.mockResolvedValue({ id: 'join-1' });
    await expect(addContactTagIfAbsent(undefined, input)).resolves.toBe(true);
    expect(mockDb.contactTag.create).toHaveBeenCalledWith({
      data: { contactId: 'contact-1', tagId: 'tag-1' },
      select: { id: true },
    });
  });

  it('treats a Prisma P2002 unique violation as an idempotent duplicate', async () => {
    mockDb.contactTag.create.mockRejectedValue(
      Object.assign(new Error('Unique constraint failed'), { code: 'P2002' }),
    );
    await expect(addContactTagIfAbsent(undefined, input)).resolves.toBe(false);
  });

  it('refuses contacts and tags outside the account', async () => {
    mockDb.contact.findFirst.mockResolvedValue(null);
    await expect(
      addContactTagIfAbsent(undefined, input)
    ).rejects.toMatchObject({ status: 404 });

    mockDb.contact.findFirst.mockResolvedValue({ id: 'contact-1' });
    mockDb.tag.findFirst.mockResolvedValue(null);
    await expect(
      addContactTagIfAbsent(undefined, input)
    ).rejects.toMatchObject({ status: 404 });
  });

  it('surfaces non-duplicate insert failures', async () => {
    mockDb.contactTag.create.mockRejectedValue(
      new Error('permission denied'),
    );
    await expect(addContactTagIfAbsent(undefined, input)).rejects.toThrow(
      'Failed to add contact tag: permission denied'
    );
  });
});

describe('removeContactTag', () => {
  it('deletes the join row for the account-scoped pair', async () => {
    mockDb.contactTag.deleteMany.mockResolvedValue({ count: 1 });
    await expect(removeContactTag(undefined, input)).resolves.toBeUndefined();
    expect(mockDb.contactTag.deleteMany).toHaveBeenCalledWith({
      where: { contactId: 'contact-1', tagId: 'tag-1' },
    });
  });

  it('refuses a contact outside the account before deleting', async () => {
    mockDb.contact.findFirst.mockResolvedValue(null);
    await expect(
      removeContactTag(undefined, input)
    ).rejects.toMatchObject({ status: 404 });
    expect(mockDb.contactTag.deleteMany).not.toHaveBeenCalled();
  });

  it('surfaces delete failures', async () => {
    mockDb.contactTag.deleteMany.mockRejectedValue(
      new Error('connection lost'),
    );
    await expect(removeContactTag(undefined, input)).rejects.toThrow(
      'Failed to remove contact tag: connection lost'
    );
  });
});
