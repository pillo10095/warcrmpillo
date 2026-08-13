// ============================================================
// OpenWAProvider unit tests. The wire shapes asserted here follow the
// OpenWA REST spec (docs/06-api-specification) exactly:
//   - media sends are a FLAT DTO { chatId, url, caption, filename }
//   - bulk is { messages:[{ chatId, type, content }], options }
//   - batch status nests counts under progress
//   - send responses are { messageId, timestamp } (epoch seconds)
// ============================================================

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { OpenWAProvider } from './openwa-provider';

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

function makeProvider() {
  return new OpenWAProvider({
    apiUrl: 'http://localhost:2785/api',
    apiKey: 'owa_k1_test',
    sessionId: 'sess-123',
  });
}

describe('OpenWAProvider', () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
  });

  it('is typed as openwa', () => {
    expect(makeProvider().type).toBe('openwa');
  });

  it('sendText posts { chatId, text } and maps the response', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ messageId: 'm-1', timestamp: 1719306115 }));

    const result = await makeProvider().sendText('+628123456789', 'hello');

    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('http://localhost:2785/api/sessions/sess-123/messages/send-text');
    expect(init.method).toBe('POST');
    expect(JSON.parse(init.body)).toEqual({ chatId: '628123456789@c.us', text: 'hello' });
    expect(result).toEqual({ messageId: 'm-1', providerMessageId: 'm-1', timestamp: 1719306115 });
  });

  it('sendMedia uses the FLAT DTO (no nested wrapper)', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ messageId: 'm-2', timestamp: 1719306115 }));

    await makeProvider().sendMedia('+628123456789', {
      type: 'image',
      url: 'https://example.com/a.jpg',
      caption: 'look',
    });

    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('http://localhost:2785/api/sessions/sess-123/messages/send-image');
    expect(JSON.parse(init.body)).toEqual({
      chatId: '628123456789@c.us',
      url: 'https://example.com/a.jpg',
      caption: 'look',
    });
  });

  it('sendBulk posts { chatId, type, content } + options', async () => {
    fetchMock.mockResolvedValue(
      jsonResponse({ batchId: 'batch_1', status: 'pending', totalMessages: 2 }, 202)
    );

    const result = await makeProvider().sendBulk([
      { to: '+628111111111', text: 'hi A' },
      { to: '+628222222222', text: 'hi B' },
    ]);

    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('http://localhost:2785/api/sessions/sess-123/messages/send-bulk');
    const body = JSON.parse(init.body);
    expect(body.messages).toEqual([
      { chatId: '628111111111@c.us', type: 'text', content: { text: 'hi A' } },
      { chatId: '628222222222@c.us', type: 'text', content: { text: 'hi B' } },
    ]);
    expect(body.options).toMatchObject({ delayBetweenMessages: 3000 });
    expect(result).toEqual({ batchId: 'batch_1', totalMessages: 2 });
  });

  it('getBatchStatus reads counts from progress', async () => {
    fetchMock.mockResolvedValue(
      jsonResponse({
        batchId: 'batch_1',
        status: 'processing',
        progress: { total: 2, sent: 1, failed: 0, pending: 1 },
      })
    );

    const status = await makeProvider().getBatchStatus('batch_1');

    expect(fetchMock.mock.calls[0][0]).toBe(
      'http://localhost:2785/api/sessions/sess-123/messages/batch/batch_1'
    );
    expect(status).toEqual({ batchId: 'batch_1', sent: 1, failed: 0, pending: 1, status: 'processing' });
  });

  it('getStatus reports connected when ready', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ status: 'ready', phone: '628123456789' }));
    const status = await makeProvider().getStatus();
    expect(status).toEqual({ connected: true, status: 'ready', phone: '628123456789' });
  });

  it('getStatus reports disconnected on gateway error without throwing', async () => {
    fetchMock.mockRejectedValue(new Error('ECONNREFUSED'));
    const status = await makeProvider().getStatus();
    expect(status.connected).toBe(false);
    expect(status.status).toContain('error');
  });

  it('throws with status + body text on non-2xx', async () => {
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify({ statusCode: 400, message: ['bad name'] }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      })
    );

    await expect(makeProvider().sendText('+628123456789', 'x')).rejects.toThrow(
      /OpenWA error \(400\)/
    );
  });

  it('createSession posts { name }', async () => {
    fetchMock.mockResolvedValue(
      jsonResponse({ id: 'sess-new', name: 'line-1', status: 'created' }, 201)
    );

    const session = await makeProvider().createSession('line-1');

    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('http://localhost:2785/api/sessions');
    expect(init.method).toBe('POST');
    expect(JSON.parse(init.body)).toEqual({ name: 'line-1' });
    expect(session).toEqual({ id: 'sess-new', name: 'line-1', status: 'created' });
  });

  it('getQr returns the PNG data URL', async () => {
    fetchMock.mockResolvedValue(
      jsonResponse({ qrCode: 'data:image/png;base64,AAAA', status: 'qr_ready' })
    );

    const qr = await makeProvider().getQr('sess-new');

    expect(fetchMock.mock.calls[0][0]).toBe(
      'http://localhost:2785/api/sessions/sess-new/qr'
    );
    expect(qr).toEqual({ qrCode: 'data:image/png;base64,AAAA', status: 'qr_ready' });
  });

  it('sends the API key in the X-API-Key header', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ messageId: 'm', timestamp: 1 }));

    await makeProvider().sendText('+628123456789', 'hi');

    const [, init] = fetchMock.mock.calls[0];
    expect(init.headers['X-API-Key']).toBe('owa_k1_test');
  });
});
