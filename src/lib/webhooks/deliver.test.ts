import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('@/lib/db/prisma', () => ({
  prisma: {
    webhookEndpoint: {
      findMany: vi.fn(),
      update: vi.fn(),
    },
  },
}));

vi.mock('@/lib/whatsapp/encryption', () => ({
  decrypt: (s: string) => s,
  encrypt: (s: string) => s,
}));

// Control the SSRF guard per-test.
vi.mock('@/lib/webhooks/ssrf', () => ({
  isDeliverableUrl: vi.fn(async () => true),
}));

import { prisma } from '@/lib/db/prisma';
import { dispatchWebhookEvent, MAX_CONSECUTIVE_FAILURES } from './deliver';
import { isDeliverableUrl } from './ssrf';

interface Row {
  id: string;
  url: string;
  secret: string;
  events: string;
}

const mockedFindMany = prisma.webhookEndpoint.findMany as ReturnType<typeof vi.fn>;
const mockedUpdate = prisma.webhookEndpoint.update as ReturnType<typeof vi.fn>;

function endpointRow(overrides: Partial<Row> = {}): Row {
  return {
    id: 'ep',
    url: 'https://a.test/hook',
    secret: 's1',
    events: JSON.stringify(['message.received']),
    ...overrides,
  };
}

beforeEach(() => {
  vi.mocked(isDeliverableUrl).mockResolvedValue(true);
  vi.stubGlobal('fetch', vi.fn());
  vi.clearAllMocks();
});
afterEach(() => vi.unstubAllGlobals());

describe('dispatchWebhookEvent', () => {
  it('signs + POSTs (no redirect follow) and resets failure_count on success', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, status: 200 } as Response);
    vi.stubGlobal('fetch', fetchMock);
    mockedFindMany.mockResolvedValue([endpointRow()]);
    mockedUpdate.mockResolvedValue({});

    await dispatchWebhookEvent('acct-1', 'message.received', { x: 1 });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, opts] = fetchMock.mock.calls[0];
    expect(url).toBe('https://a.test/hook');
    expect(opts.redirect).toBe('manual');
    expect(opts.headers['X-Wacrm-Event']).toBe('message.received');
    expect(opts.headers['X-Wacrm-Signature']).toMatch(/^t=\d+,v1=[0-9a-f]{64}$/);
    // Payload carries a dedupe id.
    expect(JSON.parse(opts.body).id).toMatch(/[0-9a-f-]{36}/);
    // Success resets failure streak atomically.
    expect(mockedUpdate).toHaveBeenCalledWith({
      where: { id: 'ep' },
      data: { failureCount: 0, lastDeliveryAt: expect.any(Date) },
    });
    expect(mockedUpdate).not.toHaveBeenCalledWith(
      expect.objectContaining({ data: { failureCount: { increment: 1 } } })
    );
  });

  it('records a failure (single atomic increment) when the endpoint errors', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 500 } as Response));
    mockedFindMany.mockResolvedValue([endpointRow()]);
    mockedUpdate.mockResolvedValue({ failureCount: 1 });

    await dispatchWebhookEvent('acct-1', 'message.received', {});

    expect(mockedUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'ep' },
        data: { failureCount: { increment: 1 } },
      })
    );
  });

  it('auto-disables the endpoint once consecutive failures cross the threshold', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 500 } as Response));
    mockedFindMany.mockResolvedValue([endpointRow()]);
    // Consecutive failures reach the disable threshold.
    mockedUpdate
      .mockResolvedValueOnce({ failureCount: MAX_CONSECUTIVE_FAILURES + 1 })
      .mockResolvedValueOnce({});

    await dispatchWebhookEvent('acct-1', 'message.received', {});

    // Auto-disable write happens after the counted increment.
    expect(mockedUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'ep' },
        data: { failureCount: { increment: 1 } },
      })
    );
    expect(mockedUpdate).toHaveBeenCalledWith({
      where: { id: 'ep' },
      data: { isActive: false },
    });
  });

  it('blocks a non-public target (SSRF guard) without fetching', async () => {
    vi.mocked(isDeliverableUrl).mockResolvedValue(false);
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    mockedFindMany.mockResolvedValue([endpointRow({ id: 'ep2', url: 'https://127.0.0.1/hook' })]);
    mockedUpdate.mockResolvedValue({ failureCount: 1 });

    await dispatchWebhookEvent('acct-1', 'message.received', {});

    expect(fetchMock).not.toHaveBeenCalled();
    expect(mockedUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'ep2' },
        data: { failureCount: { increment: 1 } },
      })
    );
  });

  it('does nothing when no endpoints are subscribed', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    mockedFindMany.mockResolvedValue([]);

    await dispatchWebhookEvent('acct-1', 'message.received', {});

    expect(fetchMock).not.toHaveBeenCalled();
    expect(mockedUpdate).not.toHaveBeenCalled();
  });
});