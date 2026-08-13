import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  openWAConfig: { findUnique: vi.fn() },
}));

vi.mock('@/lib/db/prisma', () => ({ prisma: mocks }));
vi.mock('@/lib/whatsapp/encryption', () => ({
  encrypt: (v: string) => v,
  decrypt: (v: string) => v,
}));

import {
  resolveOpenWAProvider,
  resolveOpenWAClient,
  ProviderNotConfiguredError,
} from './index';

const ACCOUNT_ID = 'acct-1';

function configRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 'cfg-1',
    accountId: ACCOUNT_ID,
    apiUrl: 'http://localhost:2785/api',
    apiKey: 'owa_key_plain', // decrypted by the encryption mock
    ...overrides,
  };
}

function sessionRow(id: string, status: string) {
  return {
    id: `row-${id}`,
    openwaSessionId: id,
    configId: 'cfg-1',
    name: `line-${id}`,
    status,
    qrCode: null,
    phone: null,
    createdAt: new Date('2026-01-01T00:00:00Z'),
    updatedAt: new Date('2026-01-01T00:00:00Z'),
  };
}

beforeEach(() => {
  mocks.openWAConfig.findUnique.mockReset();
});

describe('resolveOpenWAProvider', () => {
  it('throws when the account has no OpenWA config', async () => {
    mocks.openWAConfig.findUnique.mockResolvedValue(null);

    await expect(resolveOpenWAProvider(ACCOUNT_ID)).rejects.toMatchObject({
      name: 'ProviderNotConfiguredError',
      code: 'openwa_not_configured',
    });
    expect(mocks.openWAConfig.findUnique).toHaveBeenCalledWith({
      where: { accountId: ACCOUNT_ID },
      include: { sessions: true },
    });
  });

  it('throws when the config has no sessions', async () => {
    mocks.openWAConfig.findUnique.mockResolvedValue(configRow({ sessions: [] }));

    await expect(resolveOpenWAProvider(ACCOUNT_ID)).rejects.toMatchObject({
      code: 'openwa_no_session',
    });
  });

  it('picks the first ready session', async () => {
    mocks.openWAConfig.findUnique.mockResolvedValue(
      configRow({
        sessions: [
          sessionRow('sess-pending', 'pending'),
          sessionRow('sess-ready', 'ready'),
          sessionRow('sess-error', 'error'),
        ],
      })
    );

    const provider = await resolveOpenWAProvider(ACCOUNT_ID);

    expect(provider.type).toBe('openwa');
  });

  it('falls back to any session when none is ready', async () => {
    mocks.openWAConfig.findUnique.mockResolvedValue(
      configRow({ sessions: [sessionRow('sess-pending', 'pending')] })
    );

    const provider = await resolveOpenWAProvider(ACCOUNT_ID);
    expect(provider.type).toBe('openwa');
  });
});

describe('resolveOpenWAClient', () => {
  it('builds a management client without a sending session', async () => {
    mocks.openWAConfig.findUnique.mockResolvedValue(configRow({ sessions: [] }));

    const client = await resolveOpenWAClient(ACCOUNT_ID);
    expect(client.type).toBe('openwa');
  });
});

describe('ProviderNotConfiguredError', () => {
  it('carries a stable code', () => {
    const err = new ProviderNotConfiguredError('x', 'message');
    expect(err).toBeInstanceOf(Error);
    expect(err.code).toBe('x');
  });
});
