import { beforeEach, describe, expect, it, vi } from 'vitest';

// Prisma mock — mirrors the pattern in `send-message.test.ts`. The
// shared helpers (`findExistingContact`, `resolveAuditUserId`) run for
// REAL against this mocked client, so these tests exercise the actual
// dedupe/audit-user logic, not a scripted stub.
const mocks = vi.hoisted(() => ({
  prisma: {
    whatsAppConfig: { findFirst: vi.fn(), findUnique: vi.fn() },
    openWAConfig: { findFirst: vi.fn() },
    account: { findUnique: vi.fn() },
    contact: { findMany: vi.fn(), update: vi.fn(), create: vi.fn() },
    conversation: { findFirst: vi.fn(), create: vi.fn() },
  },
}));

vi.mock('@/lib/db/prisma', () => ({ prisma: mocks.prisma }));

import { resolveConversationByPhone } from './resolve-conversation';
import { SendMessageError } from './send-message';

const ACCOUNT_ID = 'acct';

const CONTACT_ROW = { id: 'c1', phone: '14155550123', name: null };
const CONFIG_ROW = { id: 'cfg-1' };

beforeEach(() => {
  vi.clearAllMocks();

  // Config exists + the (real) resolveAuditUserId resolves the owner
  // from the config row.
  mocks.prisma.whatsAppConfig.findFirst.mockResolvedValue(CONFIG_ROW);
  mocks.prisma.whatsAppConfig.findUnique.mockResolvedValue({
    userId: 'owner-1',
  });
  // OpenWA line configured by default; the "no config" test overrides
  // this to null together with the Meta row.
  mocks.prisma.openWAConfig.findFirst.mockResolvedValue({ id: 'owa-1' });
  // Account-owner fallback used by resolveAuditUserId when there is no
  // Meta config (OpenWA-only accounts).
  mocks.prisma.account.findUnique.mockResolvedValue({
    ownerUserId: 'owner-1',
  });

  // Defaults: no existing contact, no existing conversation.
  mocks.prisma.contact.findMany.mockResolvedValue([]);
  mocks.prisma.conversation.findFirst.mockResolvedValue(null);

  mocks.prisma.contact.update.mockResolvedValue({});
  mocks.prisma.contact.create.mockResolvedValue({ id: 'c2' });
  mocks.prisma.conversation.create.mockResolvedValue({ id: 'cv2' });
});

describe('resolveConversationByPhone', () => {
  it('rejects an invalid phone before any DB call', async () => {
    await expect(
      resolveConversationByPhone(undefined, ACCOUNT_ID, 'not-a-phone')
    ).rejects.toBeInstanceOf(SendMessageError);
    await expect(
      resolveConversationByPhone(undefined, ACCOUNT_ID, 'not-a-phone')
    ).rejects.toMatchObject({ code: 'bad_request', status: 400 });
    expect(mocks.prisma.whatsAppConfig.findFirst).not.toHaveBeenCalled();
    expect(mocks.prisma.contact.findMany).not.toHaveBeenCalled();
  });

  it('fails with whatsapp_not_configured when the account has no provider config', async () => {
    mocks.prisma.whatsAppConfig.findFirst.mockResolvedValue(null);
    mocks.prisma.openWAConfig.findFirst.mockResolvedValue(null);
    await expect(
      resolveConversationByPhone(undefined, ACCOUNT_ID, '+14155550123')
    ).rejects.toMatchObject({ code: 'whatsapp_not_configured', status: 400 });
    expect(mocks.prisma.whatsAppConfig.findUnique).not.toHaveBeenCalled();
    expect(mocks.prisma.contact.findMany).not.toHaveBeenCalled();
  });

  it('resolves when the account has OpenWA config but no Meta config', async () => {
    // OpenWA-only account: the Meta gate must not block resolution (the
    // send core validates the OpenWA config + session later).
    mocks.prisma.whatsAppConfig.findFirst.mockResolvedValue(null);
    mocks.prisma.whatsAppConfig.findUnique.mockResolvedValue(null);
    mocks.prisma.openWAConfig.findFirst.mockResolvedValue({ id: 'owa-1' });

    const res = await resolveConversationByPhone(
      undefined,
      ACCOUNT_ID,
      '+14155550123',
      'Jane'
    );
    expect(res).toEqual({
      conversationId: 'cv2',
      contactId: 'c2',
      contactCreated: true,
    });
    expect(mocks.prisma.contact.create).toHaveBeenCalledWith({
      data: {
        accountId: ACCOUNT_ID,
        userId: 'owner-1',
        phone: '14155550123',
        name: 'Jane',
      },
      select: { id: true },
    });
  });

  it('creates the conversation when the contact exists but has none', async () => {
    mocks.prisma.contact.findMany.mockResolvedValue([CONTACT_ROW]);
    const res = await resolveConversationByPhone(
      undefined,
      ACCOUNT_ID,
      '+14155550123'
    );
    expect(res).toEqual({
      conversationId: 'cv2',
      contactId: 'c1',
      contactCreated: false,
    });
    expect(mocks.prisma.conversation.create).toHaveBeenCalledWith({
      data: { accountId: ACCOUNT_ID, userId: 'owner-1', contactId: 'c1' },
      select: { id: true },
    });
    expect(mocks.prisma.contact.create).not.toHaveBeenCalled();
  });

  it('returns the existing contact + conversation without creating', async () => {
    mocks.prisma.contact.findMany.mockResolvedValue([CONTACT_ROW]);
    mocks.prisma.conversation.findFirst.mockResolvedValue({ id: 'cv1' });
    const res = await resolveConversationByPhone(
      undefined,
      ACCOUNT_ID,
      '+1 (415) 555-0123'
    );
    expect(res).toEqual({
      conversationId: 'cv1',
      contactId: 'c1',
      contactCreated: false,
    });
    expect(mocks.prisma.contact.create).not.toHaveBeenCalled();
    expect(mocks.prisma.conversation.create).not.toHaveBeenCalled();
  });

  it('updates the contact name when it differs from the stored one', async () => {
    mocks.prisma.contact.findMany.mockResolvedValue([
      { id: 'c1', phone: '14155550123', name: 'Old Name' },
    ]);
    mocks.prisma.conversation.findFirst.mockResolvedValue({ id: 'cv1' });
    const res = await resolveConversationByPhone(
      undefined,
      ACCOUNT_ID,
      '+14155550123',
      'New Name'
    );
    expect(res.contactId).toBe('c1');
    expect(res.contactCreated).toBe(false);
    expect(mocks.prisma.contact.update).toHaveBeenCalledWith({
      where: { id: 'c1' },
      data: { name: 'New Name', updatedAt: expect.any(Date) },
    });
  });

  it('creates contact + conversation when none exist', async () => {
    const res = await resolveConversationByPhone(
      undefined,
      ACCOUNT_ID,
      '+14155550199',
      'Jane'
    );
    expect(res).toEqual({
      conversationId: 'cv2',
      contactId: 'c2',
      contactCreated: true,
    });
    expect(mocks.prisma.contact.create).toHaveBeenCalledWith({
      data: {
        accountId: ACCOUNT_ID,
        userId: 'owner-1',
        phone: '14155550199',
        name: 'Jane',
      },
      select: { id: true },
    });
    expect(mocks.prisma.conversation.create).toHaveBeenCalledWith({
      data: { accountId: ACCOUNT_ID, userId: 'owner-1', contactId: 'c2' },
      select: { id: true },
    });
  });

  it('re-resolves the existing contact when the insert loses a unique race', async () => {
    // First lookup misses (→ we attempt an insert), the insert hits a
    // P2002 unique violation, and the post-race re-lookup now returns
    // the row a concurrent writer created.
    mocks.prisma.contact.findMany
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([{ id: 'c-raced', phone: '14155550123' }]);
    mocks.prisma.contact.create.mockRejectedValue({ code: 'P2002' });
    mocks.prisma.conversation.findFirst.mockResolvedValue({ id: 'cv-raced' });
    const res = await resolveConversationByPhone(
      undefined,
      ACCOUNT_ID,
      '+14155550123'
    );
    expect(res.contactId).toBe('c-raced');
    expect(res.contactCreated).toBe(false);
    expect(res.conversationId).toBe('cv-raced');
  });

  it('re-resolves the conversation when the insert loses a unique race', async () => {
    // Existing contact, conversation lookup misses first (→ attempt an
    // insert), the insert hits a P2002 from a concurrent create, and the
    // post-race re-lookup returns the winning conversation — no duplicate
    // conversation is created (issue #363).
    mocks.prisma.contact.findMany.mockResolvedValue([CONTACT_ROW]);
    mocks.prisma.conversation.findFirst
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({ id: 'cv-raced' });
    mocks.prisma.conversation.create.mockRejectedValue({ code: 'P2002' });
    const res = await resolveConversationByPhone(
      undefined,
      ACCOUNT_ID,
      '+14155550123'
    );
    expect(res).toEqual({
      conversationId: 'cv-raced',
      contactId: 'c1',
      contactCreated: false,
    });
    expect(mocks.prisma.conversation.create).toHaveBeenCalledTimes(1);
  });
});
